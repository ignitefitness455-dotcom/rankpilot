import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN?.trim();
const REPO_NAME = "rankpilot";
const ROOT_DIR = process.cwd();

if (!GITHUB_TOKEN) {
  console.error("Error: GITHUB_TOKEN environment variable is required.");
  process.exit(1);
}

const headers = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "RankPilot-Uploader",
  "Content-Type": "application/json",
};

async function ghFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
  const url = endpoint.startsWith("https://") ? endpoint : `https://api.github.com${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // raw text
  }

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText}: ${text}`);
  }
  return json;
}

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".tools",
  ".data",
  ".next",
  "coverage",
  "playwright-report",
  "test-results",
  ".git",
  ".system_generated",
]);

function getFilesToUpload(dir: string, baseDir: string): string[] {
  const entries = readdirSync(dir);
  const result: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relPath = relative(baseDir, fullPath).replace(/\\/g, "/");

    if (EXCLUDE_DIRS.has(entry)) continue;
    if (relPath.startsWith(".env") && relPath !== ".env.example") continue;
    if (
      relPath.endsWith(".tsbuildinfo") ||
      relPath.endsWith(".log") ||
      relPath.endsWith(".sqlite") ||
      relPath.endsWith(".db") ||
      relPath.endsWith(".db-shm") ||
      relPath.endsWith(".db-wal")
    ) {
      continue;
    }

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      result.push(...getFilesToUpload(fullPath, baseDir));
    } else if (stat.isFile()) {
      result.push(relPath);
    }
  }

  return result;
}

async function main() {
  console.log("Checking authenticated GitHub user...");
  const user = await ghFetch("/user");
  const owner = user.login;
  console.log(`Authenticated as GitHub user: @${owner}`);

  // 1. Ensure repository exists
  let repoExists = false;
  let repoInfo: any = null;
  try {
    repoInfo = await ghFetch(`/repos/${owner}/${REPO_NAME}`);
    repoExists = true;
    console.log(`Repository ${owner}/${REPO_NAME} already exists.`);
  } catch (err: any) {
    if (err.message.includes("404")) {
      repoExists = false;
    } else {
      throw err;
    }
  }

  if (!repoExists) {
    console.log(`Creating repository ${owner}/${REPO_NAME}...`);
    repoInfo = await ghFetch("/user/repos", {
      method: "POST",
      body: JSON.stringify({
        name: REPO_NAME,
        description: "RankPilot — Autonomous AI SEO Agent powered by Gemini 4 Argon",
        private: false,
        has_issues: true,
        has_projects: true,
        has_wiki: false,
        auto_init: false,
      }),
    });
    console.log(`Repository created successfully.`);
  }

  const defaultBranch = repoInfo?.default_branch || "main";

  // 2. Check if repository is empty (needs initial commit before git data API works)
  let parentCommitSha: string | null = null;
  let hasCommits = false;
  try {
    const branchData = await ghFetch(`/repos/${owner}/${REPO_NAME}/branches/${defaultBranch}`);
    if (branchData && branchData.commit) {
      parentCommitSha = branchData.commit.sha;
      hasCommits = true;
      console.log(`Branch '${defaultBranch}' found with head commit: ${parentCommitSha?.slice(0, 7)}`);
    }
  } catch (err: any) {
    console.log(`Branch '${defaultBranch}' not initialized yet.`);
  }

  if (!hasCommits) {
    console.log("Repository is empty. Initializing with initial commit via Contents API...");
    const readmePath = join(ROOT_DIR, "README.md");
    const readmeContent = readFileSync(readmePath).toString("base64");
    const initRes = await ghFetch(`/repos/${owner}/${REPO_NAME}/contents/README.md`, {
      method: "PUT",
      body: JSON.stringify({
        message: "feat: initialize repository with README",
        content: readmeContent,
        branch: defaultBranch,
      }),
    });
    parentCommitSha = initRes.commit.sha;
    console.log(`Initialized empty repo. First commit: ${parentCommitSha?.slice(0, 7)}`);
  }

  // 3. Collect all files to upload
  const files = getFilesToUpload(ROOT_DIR, ROOT_DIR);
  console.log(`Found ${files.length} files to push.`);

  // 4. Upload blobs in batches
  const treeItems: Array<{ path: string; mode: string; type: "blob"; sha: string }> = [];
  const BATCH_SIZE = 6;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (relPath) => {
        const fullPath = join(ROOT_DIR, relPath);
        const buffer = readFileSync(fullPath);
        const base64 = buffer.toString("base64");

        const blob = await ghFetch(`/repos/${owner}/${REPO_NAME}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({
            content: base64,
            encoding: "base64",
          }),
        });

        const isExecutable = relPath.endsWith(".sh") || relPath.startsWith("bin/");
        return {
          path: relPath,
          mode: isExecutable ? "100755" : "100644",
          type: "blob" as const,
          sha: blob.sha,
        };
      }),
    );

    treeItems.push(...batchResults);
    process.stdout.write(`Uploaded blobs: ${Math.min(i + BATCH_SIZE, files.length)} / ${files.length}\r`);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  console.log("\nAll blobs uploaded successfully.");

  // 5. Create git tree
  console.log("Creating Git tree...");
  const tree = await ghFetch(`/repos/${owner}/${REPO_NAME}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      tree: treeItems,
    }),
  });
  console.log(`Git tree created (SHA: ${tree.sha.slice(0, 10)})`);

  // 6. Create commit
  console.log("Creating Git commit...");
  const commit = await ghFetch(`/repos/${owner}/${REPO_NAME}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: "feat: initial RankPilot release (autonomous AI SEO agent)",
      tree: tree.sha,
      parents: parentCommitSha ? [parentCommitSha] : [],
    }),
  });
  console.log(`Commit created: ${commit.sha.slice(0, 10)}`);

  // 7. Update ref `refs/heads/${defaultBranch}`
  console.log(`Updating ref refs/heads/${defaultBranch}...`);
  try {
    await ghFetch(`/repos/${owner}/${REPO_NAME}/git/refs/heads/${defaultBranch}`, {
      method: "PATCH",
      body: JSON.stringify({
        sha: commit.sha,
        force: true,
      }),
    });
  } catch (err: any) {
    await ghFetch(`/repos/${owner}/${REPO_NAME}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${defaultBranch}`,
        sha: commit.sha,
      }),
    });
  }

  console.log(`\n======================================================`);
  console.log(`SUCCESS: Repository successfully pushed to GitHub!`);
  console.log(`URL: https://github.com/${owner}/${REPO_NAME}`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});

export interface RobotsRule {
  type: "allow" | "disallow";
  pattern: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySec: number | null;
}

export interface ParsedRobotsTxt {
  exists: boolean;
  statusCode: number;
  groups: RobotsGroup[];
  sitemaps: string[];
  raw: string;
}

export const AI_BOT_TOKENS = [
  "GPTBot",
  "Google-Extended",
  "PerplexityBot",
  "ClaudeBot",
  "Applebot-Extended",
] as const;

export type AiBotToken = (typeof AI_BOT_TOKENS)[number];

/**
 * Parses a robots.txt file per RFC 9309, extracting User-agent groups, Allow/Disallow rules,
 * Crawl-delay, and Sitemap URLs.
 */
export function parseRobotsTxt(raw: string, statusCode = 200): ParsedRobotsTxt {
  if (statusCode >= 400 || !raw.trim()) {
    return { exists: false, statusCode, groups: [], sitemaps: [], raw: "" };
  }

  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let currentGroup: RobotsGroup | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of raw.split(/\r?\n/)) {
    const hashIdx = rawLine.indexOf("#");
    const line = (hashIdx === -1 ? rawLine : rawLine.slice(0, hashIdx)).trim();
    if (!line) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();

    if (field === "user-agent") {
      const agent = val.toLowerCase();
      if (!currentGroup || !lastLineWasAgent) {
        currentGroup = { agents: [agent], rules: [], crawlDelaySec: null };
        groups.push(currentGroup);
      } else {
        currentGroup.agents.push(agent);
      }
      lastLineWasAgent = true;
    } else if (field === "disallow") {
      if (!currentGroup) {
        currentGroup = { agents: ["*"], rules: [], crawlDelaySec: null };
        groups.push(currentGroup);
      }
      lastLineWasAgent = false;
      if (val !== "") {
        currentGroup.rules.push({ type: "disallow", pattern: val });
      } else {
        currentGroup.rules.push({ type: "allow", pattern: "/" });
      }
    } else if (field === "allow") {
      if (!currentGroup) {
        currentGroup = { agents: ["*"], rules: [], crawlDelaySec: null };
        groups.push(currentGroup);
      }
      lastLineWasAgent = false;
      if (val !== "") {
        currentGroup.rules.push({ type: "allow", pattern: val });
      }
    } else if (field === "crawl-delay") {
      if (currentGroup) {
        const n = Number(val);
        if (!Number.isNaN(n) && n >= 0 && n <= 60) {
          currentGroup.crawlDelaySec = n;
        }
      }
      lastLineWasAgent = false;
    } else if (field === "sitemap") {
      if (val.startsWith("http://") || val.startsWith("https://")) {
        sitemaps.push(val);
      }
      lastLineWasAgent = false;
    }
  }

  return {
    exists: true,
    statusCode,
    groups,
    sitemaps: Array.from(new Set(sitemaps)),
    raw,
  };
}

function matchesRobotsPattern(pathWithQuery: string, pattern: string): boolean {
  // Convert robots.txt wildcard `*` and `$` anchor to RegExp
  const anchoredEnd = pattern.endsWith("$");
  const core = anchoredEnd ? pattern.slice(0, -1) : pattern;
  const escaped = core
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${escaped}${anchoredEnd ? "$" : ""}`);
  return regex.test(pathWithQuery);
}

function selectRulesForAgent(robots: ParsedRobotsTxt, agentToken: string): {
  rules: RobotsRule[];
  crawlDelaySec: number | null;
} {
  const token = agentToken.toLowerCase();
  const specificGroups = robots.groups.filter((g) =>
    g.agents.some((a) => a !== "*" && (token.includes(a) || a.includes(token))),
  );
  if (specificGroups.length > 0) {
    return {
      rules: specificGroups.flatMap((g) => g.rules),
      crawlDelaySec: specificGroups.find((g) => g.crawlDelaySec !== null)?.crawlDelaySec ?? null,
    };
  }
  const wildcardGroups = robots.groups.filter((g) => g.agents.includes("*"));
  return {
    rules: wildcardGroups.flatMap((g) => g.rules),
    crawlDelaySec: wildcardGroups.find((g) => g.crawlDelaySec !== null)?.crawlDelaySec ?? null,
  };
}

/**
 * Evaluates whether `pathWithQuery` (e.g. `/pricing?plan=pro`) is allowed for `agentToken`
 * using RFC 9309 longest-match precedence (ties broken in favor of Allow).
 */
export function isAllowedByRobots(
  robots: ParsedRobotsTxt,
  pathWithQuery: string,
  agentToken = "RankPilotBot",
): boolean {
  if (!robots.exists) return true;
  const path = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const { rules } = selectRulesForAgent(robots, agentToken);
  if (rules.length === 0) return true;

  let bestRule: RobotsRule | null = null;
  let bestLen = -1;

  for (const r of rules) {
    if (matchesRobotsPattern(path, r.pattern)) {
      const len = r.pattern.length;
      if (len > bestLen || (len === bestLen && r.type === "allow")) {
        bestRule = r;
        bestLen = len;
      }
    }
  }

  return bestRule ? bestRule.type === "allow" : true;
}

export function getCrawlDelayForAgent(
  robots: ParsedRobotsTxt,
  agentToken = "RankPilotBot",
): number | null {
  if (!robots.exists) return null;
  return selectRulesForAgent(robots, agentToken).crawlDelaySec;
}

export function checkAiBotAccess(
  robots: ParsedRobotsTxt,
): Record<AiBotToken, { allowed: boolean }> {
  const result = {} as Record<AiBotToken, { allowed: boolean }>;
  for (const bot of AI_BOT_TOKENS) {
    result[bot] = { allowed: isAllowedByRobots(robots, "/", bot) };
  }
  return result;
}

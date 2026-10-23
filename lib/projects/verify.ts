import { resolveTxt } from "node:dns/promises";
import { and, eq } from "drizzle-orm";
import { safeFetchUrl } from "@/lib/crawler/fetcher";
import { parseHtmlPage } from "@/lib/crawler/parse";
import { withUserDb } from "@/lib/db/rls";
import { integrations, projects, type VerifyMethod } from "@/lib/db/schema";
import { assertProjectRole } from "@/lib/security/authz";

export interface VerificationResult {
  verified: boolean;
  method: VerifyMethod;
  verifiedAt: string | null;
  detectedCms?: string | null;
  detectedLang?: string | null;
  reason?: string;
}

/**
 * Verifies ownership of a project's domain using one of 3 methods:
 * - `dns_txt`: Checks DNS TXT records on `_rankpilot-verify.<host>` or `<host>` for `rankpilot-verify=<token>`
 * - `meta_tag`: Fetches the project homepage via `safeFetchUrl` and checks `<meta name="rankpilot-verify" content="<token>">`
 * - `gsc`: Checks whether a verified Google Search Console OAuth integration is connected for this project
 */
export async function verifyProjectOwnership(params: {
  userId: string;
  projectId: string;
  method: VerifyMethod;
}): Promise<VerificationResult> {
  return withUserDb(params.userId, async (tx) => {
    await assertProjectRole(tx, params.userId, params.projectId, "editor");

    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);

    if (!project) {
      throw new Error("Project not found");
    }

    const token = project.verifyToken;
    const expectedRecord = `rankpilot-verify=${token}`;

    if (params.method === "dns_txt") {
      const host = project.host.replace(/:\d+$/, "");
      const candidateHosts = [`_rankpilot-verify.${host}`, host];
      let matched = false;

      for (const candidate of candidateHosts) {
        try {
          const txtChunks = await resolveTxt(candidate);
          const flat = txtChunks.map((chunks) => chunks.join("").trim());
          if (flat.some((entry) => entry === expectedRecord || entry === token)) {
            matched = true;
            break;
          }
        } catch {
          // DNS ENODATA / ENOTFOUND on one candidate is expected; try next
        }
      }

      if (!matched) {
        return {
          verified: false,
          method: "dns_txt",
          verifiedAt: project.verifiedAt ? project.verifiedAt.toISOString() : null,
          reason: `No DNS TXT record matching "${expectedRecord}" found on _rankpilot-verify.${host} or ${host}`,
        };
      }

      const now = new Date();
      await tx
        .update(projects)
        .set({
          verifiedAt: now,
          verifyMethod: "dns_txt",
          updatedAt: now,
        })
        .where(eq(projects.id, project.id));

      return {
        verified: true,
        method: "dns_txt",
        verifiedAt: now.toISOString(),
      };
    }

    if (params.method === "meta_tag") {
      try {
        const res = await safeFetchUrl(project.url, { timeoutMs: 12_000 });
        if (res.statusCode < 200 || res.statusCode >= 400) {
          return {
            verified: false,
            method: "meta_tag",
            verifiedAt: project.verifiedAt ? project.verifiedAt.toISOString() : null,
            reason: `Homepage returned HTTP ${res.statusCode}`,
          };
        }

        const parsed = parseHtmlPage({
          url: project.url,
          finalUrl: res.finalUrl,
          statusCode: res.statusCode,
          contentType: res.contentType,
          headers: res.headers,
          html: res.bodyText,
          bytes: res.bytes,
          ttfbMs: res.ttfbMs,
        });

        const tokenMatched =
          parsed.verifyMetaToken === token ||
          parsed.verifyMetaToken === expectedRecord;

        if (!tokenMatched) {
          return {
            verified: false,
            method: "meta_tag",
            verifiedAt: project.verifiedAt ? project.verifiedAt.toISOString() : null,
            reason: `Homepage <meta name="rankpilot-verify"> was ${
              parsed.verifyMetaToken ? `"${parsed.verifyMetaToken}"` : "not found"
            } (expected "${token}")`,
          };
        }

        const now = new Date();
        await tx
          .update(projects)
          .set({
            verifiedAt: now,
            verifyMethod: "meta_tag",
            cms: parsed.detectedCms ?? project.cms,
            language: parsed.lang ?? project.language,
            updatedAt: now,
          })
          .where(eq(projects.id, project.id));

        return {
          verified: true,
          method: "meta_tag",
          verifiedAt: now.toISOString(),
          detectedCms: parsed.detectedCms,
          detectedLang: parsed.lang,
        };
      } catch (err) {
        return {
          verified: false,
          method: "meta_tag",
          verifiedAt: project.verifiedAt ? project.verifiedAt.toISOString() : null,
          reason: `Could not fetch homepage: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // Method: gsc
    const [gscIntegration] = await tx
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.projectId, project.id),
          eq(integrations.kind, "google_oauth"),
        ),
      )
      .limit(1);

    if (!gscIntegration) {
      return {
        verified: false,
        method: "gsc",
        verifiedAt: project.verifiedAt ? project.verifiedAt.toISOString() : null,
        reason: "No Google Search Console OAuth connection found for this project yet.",
      };
    }

    const now = new Date();
    await tx
      .update(projects)
      .set({
        verifiedAt: now,
        verifyMethod: "gsc",
        updatedAt: now,
      })
      .where(eq(projects.id, project.id));

    return {
      verified: true,
      method: "gsc",
      verifiedAt: now.toISOString(),
    };
  });
}

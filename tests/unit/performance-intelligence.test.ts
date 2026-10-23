import { describe, expect, it } from "vitest";
import type { GscQueryRow } from "@/lib/google/gsc";
import { analyzeSearchPerformanceRows } from "@/lib/performance/intelligence";

describe("Phase 3: Search Console Performance Intelligence Engine", () => {
  it("detects Quick Wins (pos 4-20), CTR Gaps, Content Decay (>=30% drop), Cannibalization, and Anomalies", () => {
    const rows: GscQueryRow[] = [];

    // Generate 14 days of history: days 01..07 = previous window, days 08..14 = recent window
    for (let d = 1; d <= 14; d++) {
      const date = `2026-03-${String(d).padStart(2, "0")}`;
      const isRecent = d >= 8;

      // 1. Quick Win & CTR Gap query at position 6.2 with high impressions (150/day) and low CTR (1.3%)
      rows.push({
        date,
        page: "https://example.com/features/audit",
        query: "technical seo audit tool",
        country: "USA",
        device: "DESKTOP",
        impressions: 150,
        clicks: 2,
        ctr: 2 / 150,
        position: 6.2,
      });

      // Brand query that experiences a Day 14 traffic spike (statistical daily click anomaly |z| >= 2.5)
      rows.push({
        date,
        page: "https://example.com/",
        query: "rankpilot brand",
        country: "USA",
        device: "DESKTOP",
        impressions: 300,
        clicks: d === 14 ? 180 : 15,
        ctr: (d === 14 ? 180 : 15) / 300,
        position: 1.2,
      });

      // 2. Content Decay page: 20 clicks/day in previous window -> 6 clicks/day in recent window (-70% drop)
      rows.push({
        date,
        page: "https://example.com/blog/legacy-guide",
        query: "seo checklist",
        country: "USA",
        device: "DESKTOP",
        impressions: 200,
        clicks: isRecent ? 6 : 20,
        ctr: (isRecent ? 6 : 20) / 200,
        position: isRecent ? 8.5 : 3.2,
      });

      // 3. Keyword Cannibalization: two URLs splitting impressions ~55% / ~45% for "ai seo agent"
      rows.push({
        date,
        page: "https://example.com/ai-seo",
        query: "ai seo agent",
        country: "USA",
        device: "DESKTOP",
        impressions: 55,
        clicks: 4,
        ctr: 4 / 55,
        position: 7.4,
      });
      rows.push({
        date,
        page: "https://example.com/blog/what-is-ai-seo-agent",
        query: "ai seo agent",
        country: "USA",
        device: "DESKTOP",
        impressions: 45,
        clicks: 3,
        ctr: 3 / 45,
        position: 8.1,
      });
    }

    const report = analyzeSearchPerformanceRows(rows, "google_oauth");

    expect(report.hasData).toBe(true);
    expect(report.overview.dailySeries).toHaveLength(14);

    // Quick Wins should include "technical seo audit tool" or "ai seo agent" (positions 4..20)
    expect(report.quickWins.length).toBeGreaterThan(0);
    expect(
      report.quickWins.some((q) => q.query === "technical seo audit tool" || q.query === "ai seo agent"),
    ).toBe(true);

    // CTR Gaps should detect underperforming CTR
    expect(report.ctrGaps.length).toBeGreaterThan(0);

    // Content Decay should flag /blog/legacy-guide (-70% drop)
    const decayed = report.decay.find(
      (d) => d.page === "https://example.com/blog/legacy-guide",
    );
    expect(decayed).toBeDefined();
    expect(decayed?.dropPct).toBeGreaterThanOrEqual(30);
    expect(decayed?.severity).toBe("critical");

    // Keyword Cannibalization should flag "ai seo agent" across the 2 competing URLs
    const cann = report.cannibalization.find((c) => c.query === "ai seo agent");
    expect(cann).toBeDefined();
    expect(cann?.competingPages).toHaveLength(2);

    // Anomaly detector should catch the Day 14 spike
    expect(report.anomalies.length).toBeGreaterThan(0);
    expect(report.anomalies[0]?.date).toBe("2026-03-14");
  });
});

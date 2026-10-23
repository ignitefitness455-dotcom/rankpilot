import { describe, expect, it } from "vitest";
import { findingSchema } from "@/lib/schemas/finding";

describe("lib/schemas/finding — §11 Structured Output Contract", () => {
  it("validates a deterministic crawler finding", () => {
    const valid = findingSchema.parse({
      id: "TECH-CANON-003",
      category: "technical",
      severity: "critical",
      title: "Canonical tag points to a 404 URL",
      why_it_matters:
        "Search engines ignore broken canonical targets and may de-index this page.",
      evidence: [
        {
          url: "https://example.com/pricing",
          observed: 'rel="canonical" points to https://example.com/old-pricing (HTTP 404)',
          source: "crawler",
          timestamp: "2026-10-23T00:00:00Z",
        },
      ],
      affected_count: 1,
      fix: {
        steps: ["Update the canonical link element to point to https://example.com/pricing."],
        code_snippet: '<link rel="canonical" href="https://example.com/pricing" />',
        language: "html",
      },
      impact: 5,
      effort: 1,
      confidence: 1.0,
      is_estimate: false,
    });

    expect(valid.id).toBe("TECH-CANON-003");
  });

  it("rejects model-sourced evidence when is_estimate is false (Principle #1)", () => {
    expect(() =>
      findingSchema.parse({
        id: "CONT-GAP-001",
        category: "content",
        severity: "warning",
        title: "Missing comparison section",
        why_it_matters: "Competitors answer pricing questions directly.",
        evidence: [
          {
            url: "https://example.com/guide",
            observed: "Model inferred missing subtopic",
            source: "model",
            timestamp: "2026-10-23T00:00:00Z",
          },
        ],
        affected_count: 1,
        fix: {
          steps: ["Add an H2 pricing section."],
          code_snippet: null,
          language: "text",
        },
        impact: 3,
        effort: 2,
        confidence: 0.75,
        is_estimate: false,
      }),
    ).toThrow(/is_estimate=true/);
  });
});

import type { Finding } from "@/lib/schemas/finding";

export type AuditCategory = Finding["category"];

export interface AuditScoreBreakdown {
  overall: number;
  categories: Record<AuditCategory, number>;
  countsBySeverity: {
    critical: number;
    warning: number;
    info: number;
  };
}

const ALL_CATEGORIES: AuditCategory[] = [
  "technical",
  "on_page",
  "content",
  "links",
  "performance",
  "ai_search",
];

const CATEGORY_WEIGHTS: Record<AuditCategory, number> = {
  technical: 0.25,
  on_page: 0.2,
  content: 0.15,
  links: 0.15,
  performance: 0.15,
  ai_search: 0.1,
};

const SEVERITY_BASE_PENALTY: Record<Finding["severity"], number> = {
  critical: 18,
  warning: 8,
  info: 2,
};

/**
 * Computes a deterministic 0-100 SEO Health Score and category breakdown
 * from the active findings on a crawl.
 *
 * Penalty per finding scales logarithmically with the ratio of affected pages
 * so a single broken tag on 1 page has less penalty than across 100% of pages.
 */
export function computeAuditScore(
  findings: Finding[],
  totalCrawledPages: number,
): AuditScoreBreakdown {
  const safeTotalPages = Math.max(1, totalCrawledPages);

  const categoryPenalties: Record<AuditCategory, number> = {
    technical: 0,
    on_page: 0,
    content: 0,
    links: 0,
    performance: 0,
    ai_search: 0,
  };

  const countsBySeverity = {
    critical: 0,
    warning: 0,
    info: 0,
  };

  for (const finding of findings) {
    countsBySeverity[finding.severity] += 1;
    const base = SEVERITY_BASE_PENALTY[finding.severity];
    const ratio = Math.min(1, finding.affected_count / safeTotalPages);
    // Scale between 0.6x (single instance) and 1.35x (site-wide)
    const scale = 0.6 + 0.75 * Math.sqrt(ratio);
    const impactFactor = 0.7 + (finding.impact / 5) * 0.6;
    const penalty = base * scale * impactFactor;
    categoryPenalties[finding.category] += penalty;
  }

  const categories: Record<AuditCategory, number> = {
    technical: 100,
    on_page: 100,
    content: 100,
    links: 100,
    performance: 100,
    ai_search: 100,
  };

  let weightedSum = 0;
  for (const cat of ALL_CATEGORIES) {
    const rawScore = Math.max(0, Math.min(100, Math.round(100 - categoryPenalties[cat])));
    categories[cat] = rawScore;
    weightedSum += rawScore * CATEGORY_WEIGHTS[cat];
  }

  const overall = Math.max(0, Math.min(100, Math.round(weightedSum)));

  return {
    overall,
    categories,
    countsBySeverity,
  };
}

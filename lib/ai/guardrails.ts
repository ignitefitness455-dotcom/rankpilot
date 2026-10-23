import { sha256Hex } from "@/lib/security/crypto";

export type SpamViolationCategory =
  | "cloaking"
  | "link_scheme"
  | "scaled_spam"
  | "fake_reviews"
  | "keyword_stuffing"
  | "hidden_text";

export interface WhiteHatPolicyResult {
  allowed: boolean;
  violationCategory?: SpamViolationCategory;
  reason?: string;
  refusalMessage?: string;
  whiteHatAlternative?: string;
}

interface SpamRulePattern {
  category: SpamViolationCategory;
  patterns: RegExp[];
  reason: string;
  refusalMessage: string;
  whiteHatAlternative: string;
}

const SPAM_POLICY_RULES: SpamRulePattern[] = [
  {
    category: "cloaking",
    patterns: [
      /\bcloak(?:ing|ed)?\b.*\b(googlebot|crawler|bot|user-agent|search\s+engine)/i,
      /\bshow\s+different\s+(?:[a-z]+\s+)?(?:content|html|page|text)\s+to\s+(?:google|googlebot|crawlers|bots|users)\b/i,
      /\bserve\s+(?:one|different)\s+version\s+to\s+(?:googlebot|bots)\b/i,
      /\bsneaky\s+redirect/i,
    ],
    reason:
      "Showing different content or URLs to human users and search engine crawlers violates Google Search Essentials (Cloaking & Sneaky Redirects).",
    refusalMessage:
      "I cannot help implement cloaking or serve different content to Googlebot versus human visitors. Google treats cloaking as a critical spam policy violation that can result in manual demotion or complete de-indexing of your site.",
    whiteHatAlternative:
      "Serve the exact same primary content to both users and crawlers. If you use dynamic rendering or localization, use standard HTTP `Vary` headers, `hreflang` annotations, and ensure all visible text matches what Googlebot receives.",
  },
  {
    category: "link_scheme",
    patterns: [
      /\bbuy(?:ing)?(?:\s+[\w-]+){0,3}\s+(?:backlinks?|dofollow\s+links?|pbn\s+links?|links?)\b/i,
      /\bprivate\s+blog\s+network|\bpbn\b/i,
      /\blink\s+(?:farm|wheel|exchange\s+scheme|injection)\b/i,
      /\bautomated\s+backlink\s+(?:blast|generator|spam)\b/i,
    ],
    reason:
      "Buying/selling links that pass ranking credit or building Private Blog Networks (PBNs) violates Google's Link Spam policy.",
    refusalMessage:
      "I cannot assist with buying backlinks, Private Blog Networks (PBNs), or automated link schemes. Paid or manipulative links violate Google's Link Spam policies and risk algorithmic neutralization (SpamBrain) or a manual unnatural-links action.",
    whiteHatAlternative:
      "Build authority through digital PR, original benchmark data or calculators that journalists and peers naturally cite, and strengthen internal linking from your highest-authority pages to priority landing pages.",
  },
  {
    category: "scaled_spam",
    patterns: [
      /\b(?:generate|spin|publish|mass[- ]produce)\s+\d{2,}\s+(?:ai\s+)?(?:pages|articles|posts|doorway\s+pages)\s+(?:automatically|at\s+scale|without\s+review)/i,
      /\bdoorway\s+pages?\b/i,
      /\bmass\s+page\s+generator\b/i,
      /\b programmatic\s+spam\b/i,
    ],
    reason:
      "Generating many thin or near-duplicate doorway pages purely to manipulate search rankings violates Google's Scaled Content Abuse & Doorway policies.",
    refusalMessage:
      "I cannot mass-generate unreviewed doorway pages or scaled low-value AI articles. Google's Scaled Content Abuse policy penalizes pages created primarily to manipulate search rankings without original value or human oversight.",
    whiteHatAlternative:
      "Focus on fewer, comprehensive topic cluster pages backed by real first-hand experience (E-E-A-T), unique data per URL, and mandatory human editorial review before publishing.",
  },
  {
    category: "fake_reviews",
    patterns: [
      /\b(?:write|generate|fabricate|post|create)\s+fake\s+(?:reviews|testimonials|ratings|star\s+ratings)\b/i,
      /\bfake\s+aggregate\s*rating\s+schema\b/i,
      /\bself[- ]serving\s+review\s+markup\s+with\s+invented\s+ratings\b/i,
    ],
    reason:
      "Fabricating reviews or adding AggregateRating schema for unverified/fake ratings violates Google Structured Data & Review Snippet guidelines and consumer protection laws.",
    refusalMessage:
      "I cannot generate fake customer reviews or fabricate `AggregateRating` structured data. Fake reviews violate Google's Review Snippet guidelines and FTC/consumer protection regulations.",
    whiteHatAlternative:
      "Collect genuine reviews from verified customers via post-purchase email prompts, display them transparently on the page, and only mark up real, verifiable ratings in JSON-LD.",
  },
  {
    category: "keyword_stuffing",
    patterns: [
      /\bstuff\s+(?:keywords|the\s+keyword)\b/i,
      /\brepeat\s+(?:the\s+)?keyword\s+\d{2,}\s+times\b/i,
      /\bkeyword\s+density\s+(?:of\s+)?(?:1[0-9]|[2-9]\d)%/i,
    ],
    reason:
      "Repeating keywords unnaturally or targeting excessive keyword density violates Google's Keyword Stuffing spam policy.",
    refusalMessage:
      "I cannot stuff keywords unnaturally into your copy, meta tags, or alt attributes. Keyword stuffing harms readability and triggers Google's spam classifiers.",
    whiteHatAlternative:
      "Include the primary keyword naturally in the `<title>`, `<h1>`, opening paragraph, and 1–2 relevant subheadings while covering related entities and user questions in clear, natural prose.",
  },
  {
    category: "hidden_text",
    patterns: [
      /\bhide\s+(?:keywords|text|links)\s+(?:with|using|in)\s+(?:white\s+text|display\s*:\s*none|font-size\s*:\s*0|off[- ]screen)/i,
      /\binvisible\s+seo\s+text\b/i,
    ],
    reason:
      "Hiding text or links from users via CSS while exposing them to search crawlers violates Google's Hidden Text and Links policy.",
    refusalMessage:
      "I cannot create hidden SEO text or invisible links (`font-size: 0`, white-on-white text, or off-screen positioning). Google detects and penalizes hidden text.",
    whiteHatAlternative:
      "Make all helpful copy visible to users—if space is constrained, use accessible accordion (`<details>/<summary>`) or tab components that users can genuinely read and interact with.",
  },
];

/**
 * Evaluates a user prompt or task instruction against RankPilot's non-negotiable White-Hat policy (§4.2).
 */
export function evaluateWhiteHatPolicy(text: string): WhiteHatPolicyResult {
  const normalized = text.trim();
  if (!normalized) return { allowed: true };

  for (const rule of SPAM_POLICY_RULES) {
    if (rule.patterns.some((re) => re.test(normalized))) {
      return {
        allowed: false,
        violationCategory: rule.category,
        reason: rule.reason,
        refusalMessage: rule.refusalMessage,
        whiteHatAlternative: rule.whiteHatAlternative,
      };
    }
  }

  return { allowed: true };
}

export interface InjectionScanResult {
  flagged: boolean;
  matches: string[];
  sanitizedText: string;
}

const INJECTION_PATTERNS: { label: string; regex: RegExp }[] = [
  {
    label: "ignore_previous_instructions",
    regex: /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions|prompts|rules)\b/i,
  },
  {
    label: "system_prompt_override",
    regex: /\b(?:system\s*prompt|developer\s*instruction|new\s*system\s*role)\s*:/i,
  },
  {
    label: "role_hijack",
    regex: /\byou\s+are\s+now\s+(?:in\s+developer\s+mode|dan|an\s+unrestricted\s+ai|obligated\s+to\s+call)\b/i,
  },
  {
    label: "tool_invocation_spoof",
    regex: /\b(?:call|invoke|execute)\s+tool\s+[`"']?(?:crawl_site|create_task|delegate|gsc_query|fetch_url)[`"']?/i,
  },
  {
    label: "xml_boundary_escape",
    regex: /<\/\s*untrusted_page_content\s*>/i,
  },
];

/**
 * Scans untrusted crawled text for prompt-injection attempts and neutralizes boundary-escape tags.
 */
export function detectPromptInjection(rawText: string): InjectionScanResult {
  const withoutScriptsAndComments = rawText
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const matches: string[] = [];
  for (const p of INJECTION_PATTERNS) {
    if (p.regex.test(withoutScriptsAndComments)) {
      matches.push(p.label);
    }
  }

  // Neutralize closing XML tags that could break out of <untrusted_page_content>
  const sanitizedText = withoutScriptsAndComments
    .replace(/<\/?\s*untrusted_page_content[^>]*>/gi, "[STRIPPED_TAG]")
    .replace(/<\/?\s*project_profile[^>]*>/gi, "[STRIPPED_TAG]")
    .replace(/\s+/g, " ")
    .trim();

  return {
    flagged: matches.length > 0,
    matches,
    sanitizedText,
  };
}

/**
 * Wraps crawled page text in `<untrusted_page_content>` XML tags (§5.8) so Gemini treats it
 * strictly as passive data and never executes instructions found inside a web page.
 */
export function wrapUntrustedPageContent(params: {
  url: string;
  rawText: string;
  maxChars?: number;
}): {
  wrappedXml: string;
  flagged: boolean;
  matches: string[];
  sha256: string;
} {
  const maxChars = params.maxChars ?? 6000;
  const scan = detectPromptInjection(params.rawText);
  const clipped =
    scan.sanitizedText.length > maxChars
      ? `${scan.sanitizedText.slice(0, maxChars)}…[truncated]`
      : scan.sanitizedText;
  const sha256 = sha256Hex(clipped).slice(0, 16);

  const safeUrl = params.url.replace(/"/g, "%22");
  const wrappedXml = [
    `<untrusted_page_content url="${safeUrl}" sha256="${sha256}" injection_flagged="${scan.flagged}">`,
    clipped,
    `</untrusted_page_content>`,
  ].join("\n");

  return {
    wrappedXml,
    flagged: scan.flagged,
    matches: scan.matches,
    sha256,
  };
}

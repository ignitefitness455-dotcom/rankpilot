import { describe, expect, it } from "vitest";
import {
  generateSchemaJsonLd,
  SUPPORTED_SCHEMA_TYPES,
  validateSchemaJsonLd,
} from "@/lib/schema-gen/generator";

describe("Phase 4: JSON-LD Schema Generator & Validator (All 8 Types)", () => {
  it("supports exactly the 8 required Rich Result schema.org types", () => {
    expect(SUPPORTED_SCHEMA_TYPES).toEqual([
      "Article",
      "FAQPage",
      "HowTo",
      "Product",
      "SoftwareApplication",
      "Organization",
      "BreadcrumbList",
      "LocalBusiness",
    ]);
  });

  it("generates and validates all 8 schema.org types with zero validation errors", () => {
    const article = generateSchemaJsonLd({
      type: "Article",
      headline: "Complete Technical SEO Architecture Guide for Next.js 16",
      description:
        "Deep-dive engineering guide covering canonicals, Core Web Vitals, and structured data.",
      url: "https://rankpilot.example.com/guides/nextjs-seo",
      imageUrl: "https://rankpilot.example.com/og-nextjs.png",
      authorName: "RankPilot Engineering",
      publisherName: "RankPilot",
      publisherLogoUrl: "https://rankpilot.example.com/logo.png",
      datePublished: "2026-10-20",
      dateModified: "2026-10-23",
    });
    expect(article.validation.valid).toBe(true);
    expect(article.validation.errors).toHaveLength(0);
    expect(article.scriptTagSnippet).toContain('"@type": "Article"');

    const faq = generateSchemaJsonLd({
      type: "FAQPage",
      questions: [
        {
          question: "What is an 8-gram shingle originality check?",
          answer:
            "It verifies that no 8-word contiguous sequence in your draft copies competitor source material.",
        },
      ],
    });
    expect(faq.validation.valid).toBe(true);
    expect(faq.scriptTagSnippet).toContain('"@type": "FAQPage"');

    const howTo = generateSchemaJsonLd({
      type: "HowTo",
      name: "How to Audit Core Web Vitals with PageSpeed Insights",
      description: "Step-by-step instructions to measure LCP, INP, and CLS.",
      totalTimeIso: "PT15M",
      steps: [
        {
          name: "Run Mobile Lab Test",
          text: "Execute a PageSpeed Insights v5 check on your primary landing page.",
        },
        {
          name: "Compare CrUX Field p75",
          text: "Inspect 28-day Chrome UX Report p75 thresholds for LCP, INP, and CLS.",
        },
      ],
    });
    expect(howTo.validation.valid).toBe(true);
    expect(howTo.scriptTagSnippet).toContain('"@type": "HowTo"');

    const product = generateSchemaJsonLd({
      type: "Product",
      name: "RankPilot Cloud Team Plan",
      description: "Autonomous SEO Agent workspace with multi-project support.",
      brandName: "RankPilot",
      price: "79.00",
      priceCurrency: "USD",
      availability: "InStock",
      url: "https://rankpilot.example.com/pricing",
    });
    expect(product.validation.valid).toBe(true);
    expect(product.scriptTagSnippet).toContain('"@type": "Product"');

    const app = generateSchemaJsonLd({
      type: "SoftwareApplication",
      name: "RankPilot",
      description: "AI SEO Agent powered by Gemini 4 Argon.",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Windows, macOS, Linux",
      price: "0",
      priceCurrency: "USD",
      url: "https://rankpilot.example.com",
    });
    expect(app.validation.valid).toBe(true);
    expect(app.scriptTagSnippet).toContain('"@type": "SoftwareApplication"');

    const org = generateSchemaJsonLd({
      type: "Organization",
      name: "RankPilot Labs",
      url: "https://rankpilot.example.com",
      logoUrl: "https://rankpilot.example.com/icon-512.png",
      contactEmail: "support@rankpilot.example.com",
    });
    expect(org.validation.valid).toBe(true);
    expect(org.scriptTagSnippet).toContain('"@type": "Organization"');

    const breadcrumbs = generateSchemaJsonLd({
      type: "BreadcrumbList",
      items: [
        { name: "Home", itemUrl: "https://rankpilot.example.com" },
        { name: "Docs", itemUrl: "https://rankpilot.example.com/docs" },
      ],
    });
    expect(breadcrumbs.validation.valid).toBe(true);
    expect(breadcrumbs.scriptTagSnippet).toContain('"@type": "BreadcrumbList"');

    const localBiz = generateSchemaJsonLd({
      type: "LocalBusiness",
      name: "RankPilot Studio Dhaka",
      url: "https://rankpilot.example.com/dhaka",
      telephone: "+880-1700-000000",
      streetAddress: "Gulshan Avenue 42",
      addressLocality: "Dhaka",
      postalCode: "1212",
      addressCountry: "BD",
    });
    expect(localBiz.validation.valid).toBe(true);
    expect(localBiz.scriptTagSnippet).toContain('"@type": "LocalBusiness"');
  });

  it("flags missing required properties and warns on unverified AggregateRating", () => {
    const badFaq = validateSchemaJsonLd({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [],
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: "5.0",
        reviewCount: "999",
      },
    });

    expect(badFaq.valid).toBe(false);
    expect(badFaq.errors.some((e) => e.path === "mainEntity")).toBe(true);
    expect(badFaq.warnings.some((w) => w.path === "aggregateRating")).toBe(true);

    const badLocalBusiness = validateSchemaJsonLd(
      `<script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          "name": "Missing Address Co"
        }
      </script>`,
    );
    expect(badLocalBusiness.valid).toBe(false);
    expect(badLocalBusiness.errors.some((e) => e.path === "address")).toBe(true);
  });
});

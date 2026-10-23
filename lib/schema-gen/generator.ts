import { z } from "zod";

export const SUPPORTED_SCHEMA_TYPES = [
  "Article",
  "FAQPage",
  "HowTo",
  "Product",
  "SoftwareApplication",
  "Organization",
  "BreadcrumbList",
  "LocalBusiness",
] as const;

export type SupportedSchemaType = (typeof SUPPORTED_SCHEMA_TYPES)[number];

export interface SchemaValidationIssue {
  path: string;
  severity: "error" | "warning";
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  detectedType: SupportedSchemaType | string | null;
  errors: SchemaValidationIssue[];
  warnings: SchemaValidationIssue[];
  normalizedJsonLd: Record<string, unknown> | null;
  scriptTagSnippet: string | null;
}

export const ArticleInputSchema = z.object({
  type: z.literal("Article"),
  headline: z.string().min(5).max(110),
  description: z.string().min(10).max(320),
  url: z.url(),
  imageUrl: z.url().optional(),
  authorName: z.string().min(2).max(120),
  authorUrl: z.url().optional(),
  publisherName: z.string().min(2).max(120),
  publisherLogoUrl: z.url().optional(),
  datePublished: z.string().min(8),
  dateModified: z.string().min(8).optional(),
});

export const FaqPageInputSchema = z.object({
  type: z.literal("FAQPage"),
  questions: z
    .array(
      z.object({
        question: z.string().min(5).max(300),
        answer: z.string().min(10).max(2000),
      }),
    )
    .min(1)
    .max(25),
});

export const HowToInputSchema = z.object({
  type: z.literal("HowTo"),
  name: z.string().min(5).max(150),
  description: z.string().min(10).max(500),
  totalTimeIso: z.string().optional(),
  estimatedCostCurrency: z.string().length(3).optional(),
  estimatedCostValue: z.string().optional(),
  supplies: z.array(z.string().min(1)).optional(),
  tools: z.array(z.string().min(1)).optional(),
  steps: z
    .array(
      z.object({
        name: z.string().min(2).max(150),
        text: z.string().min(5).max(1000),
        url: z.url().optional(),
        imageUrl: z.url().optional(),
      }),
    )
    .min(2)
    .max(30),
});

export const ProductInputSchema = z.object({
  type: z.literal("Product"),
  name: z.string().min(2).max(150),
  description: z.string().min(10).max(500),
  imageUrl: z.url().optional(),
  sku: z.string().optional(),
  brandName: z.string().min(1).max(120),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
  priceCurrency: z.string().length(3).default("USD"),
  availability: z
    .enum(["InStock", "OutOfStock", "PreOrder", "OnlineOnly"])
    .default("InStock"),
  url: z.url(),
});

export const SoftwareApplicationInputSchema = z.object({
  type: z.literal("SoftwareApplication"),
  name: z.string().min(2).max(150),
  description: z.string().min(10).max(500),
  applicationCategory: z.string().min(2).max(100).default("BusinessApplication"),
  operatingSystem: z.string().min(2).max(100).default("Web, Windows, macOS"),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  priceCurrency: z.string().length(3).default("USD"),
  url: z.url().optional(),
  softwareVersion: z.string().optional(),
});

export const OrganizationInputSchema = z.object({
  type: z.literal("Organization"),
  name: z.string().min(2).max(150),
  url: z.url(),
  logoUrl: z.url(),
  description: z.string().optional(),
  sameAs: z.array(z.url()).optional(),
  contactEmail: z.email().optional(),
  contactPhone: z.string().optional(),
});

export const BreadcrumbListInputSchema = z.object({
  type: z.literal("BreadcrumbList"),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        itemUrl: z.url(),
      }),
    )
    .min(1)
    .max(15),
});

export const LocalBusinessInputSchema = z.object({
  type: z.literal("LocalBusiness"),
  name: z.string().min(2).max(150),
  description: z.string().min(10).max(500).optional(),
  url: z.url(),
  telephone: z.string().min(5).max(40),
  priceRange: z.string().max(10).optional(),
  imageUrl: z.url().optional(),
  streetAddress: z.string().min(2).max(200),
  addressLocality: z.string().min(2).max(120),
  addressRegion: z.string().max(120).optional(),
  postalCode: z.string().min(2).max(30),
  addressCountry: z.string().min(2).max(60),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const SchemaGenerationInputSchema = z.discriminatedUnion("type", [
  ArticleInputSchema,
  FaqPageInputSchema,
  HowToInputSchema,
  ProductInputSchema,
  SoftwareApplicationInputSchema,
  OrganizationInputSchema,
  BreadcrumbListInputSchema,
  LocalBusinessInputSchema,
]);

export type SchemaGenerationInput = z.infer<typeof SchemaGenerationInputSchema>;

/**
 * Formats a JSON-LD object into a ready-to-paste HTML `<script type="application/ld+json">` tag.
 */
export function formatJsonLdScriptTag(jsonLd: Record<string, unknown>): string {
  return `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>`;
}

/**
 * Deterministically builds a schema.org JSON-LD object for any of the 8 supported types
 * and runs strict required-property validation before returning.
 */
export function generateSchemaJsonLd(rawInput: SchemaGenerationInput): {
  jsonLd: Record<string, unknown>;
  scriptTagSnippet: string;
  validation: SchemaValidationResult;
} {
  const input = SchemaGenerationInputSchema.parse(rawInput);
  let jsonLd: Record<string, unknown>;

  switch (input.type) {
    case "Article": {
      jsonLd = {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: input.headline,
        description: input.description,
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": input.url,
        },
        ...(input.imageUrl ? { image: [input.imageUrl] } : {}),
        author: {
          "@type": "Person",
          name: input.authorName,
          ...(input.authorUrl ? { url: input.authorUrl } : {}),
        },
        publisher: {
          "@type": "Organization",
          name: input.publisherName,
          ...(input.publisherLogoUrl
            ? {
                logo: {
                  "@type": "ImageObject",
                  url: input.publisherLogoUrl,
                },
              }
            : {}),
        },
        datePublished: input.datePublished,
        dateModified: input.dateModified ?? input.datePublished,
      };
      break;
    }

    case "FAQPage": {
      jsonLd = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: input.questions.map((q) => ({
          "@type": "Question",
          name: q.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: q.answer,
          },
        })),
      };
      break;
    }

    case "HowTo": {
      jsonLd = {
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: input.name,
        description: input.description,
        ...(input.totalTimeIso ? { totalTime: input.totalTimeIso } : {}),
        ...(input.estimatedCostCurrency && input.estimatedCostValue
          ? {
              estimatedCost: {
                "@type": "MonetaryAmount",
                currency: input.estimatedCostCurrency,
                value: input.estimatedCostValue,
              },
            }
          : {}),
        ...(input.supplies && input.supplies.length > 0
          ? {
              supply: input.supplies.map((s) => ({
                "@type": "HowToSupply",
                name: s,
              })),
            }
          : {}),
        ...(input.tools && input.tools.length > 0
          ? {
              tool: input.tools.map((t) => ({
                "@type": "HowToTool",
                name: t,
              })),
            }
          : {}),
        step: input.steps.map((step, idx) => ({
          "@type": "HowToStep",
          position: idx + 1,
          name: step.name,
          text: step.text,
          ...(step.url ? { url: step.url } : {}),
          ...(step.imageUrl ? { image: step.imageUrl } : {}),
        })),
      };
      break;
    }

    case "Product": {
      jsonLd = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: input.name,
        description: input.description,
        ...(input.imageUrl ? { image: [input.imageUrl] } : {}),
        ...(input.sku ? { sku: input.sku } : {}),
        brand: {
          "@type": "Brand",
          name: input.brandName,
        },
        offers: {
          "@type": "Offer",
          url: input.url,
          priceCurrency: input.priceCurrency,
          price: input.price,
          availability: `https://schema.org/${input.availability}`,
        },
      };
      break;
    }

    case "SoftwareApplication": {
      jsonLd = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: input.name,
        description: input.description,
        applicationCategory: input.applicationCategory,
        operatingSystem: input.operatingSystem,
        offers: {
          "@type": "Offer",
          price: input.price,
          priceCurrency: input.priceCurrency,
        },
        ...(input.url ? { url: input.url } : {}),
        ...(input.softwareVersion ? { softwareVersion: input.softwareVersion } : {}),
      };
      break;
    }

    case "Organization": {
      jsonLd = {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: input.name,
        url: input.url,
        logo: input.logoUrl,
        ...(input.description ? { description: input.description } : {}),
        ...(input.sameAs && input.sameAs.length > 0 ? { sameAs: input.sameAs } : {}),
        ...(input.contactEmail || input.contactPhone
          ? {
              contactPoint: {
                "@type": "ContactPoint",
                contactType: "customer support",
                ...(input.contactEmail ? { email: input.contactEmail } : {}),
                ...(input.contactPhone ? { telephone: input.contactPhone } : {}),
              },
            }
          : {}),
      };
      break;
    }

    case "BreadcrumbList": {
      jsonLd = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: input.items.map((item, idx) => ({
          "@type": "ListItem",
          position: idx + 1,
          name: item.name,
          item: item.itemUrl,
        })),
      };
      break;
    }

    case "LocalBusiness": {
      jsonLd = {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        url: input.url,
        telephone: input.telephone,
        ...(input.priceRange ? { priceRange: input.priceRange } : {}),
        ...(input.imageUrl ? { image: [input.imageUrl] } : {}),
        address: {
          "@type": "PostalAddress",
          streetAddress: input.streetAddress,
          addressLocality: input.addressLocality,
          ...(input.addressRegion ? { addressRegion: input.addressRegion } : {}),
          postalCode: input.postalCode,
          addressCountry: input.addressCountry,
        },
        ...(input.latitude !== undefined && input.longitude !== undefined
          ? {
              geo: {
                "@type": "GeoCoordinates",
                latitude: input.latitude,
                longitude: input.longitude,
              },
            }
          : {}),
      };
      break;
    }
  }

  const validation = validateSchemaJsonLd(jsonLd);
  return {
    jsonLd,
    scriptTagSnippet: formatJsonLdScriptTag(jsonLd),
    validation,
  };
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Validates raw JSON-LD (either a JSON string or parsed object) against schema.org and
 * Google Rich Results required & recommended property rules for the 8 supported types.
 */
export function validateSchemaJsonLd(rawInput: unknown): SchemaValidationResult {
  const errors: SchemaValidationIssue[] = [];
  const warnings: SchemaValidationIssue[] = [];

  let parsed: unknown = rawInput;
  if (typeof rawInput === "string") {
    const stripped = rawInput
      .trim()
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();
    try {
      parsed = JSON.parse(stripped);
    } catch (err) {
      return {
        valid: false,
        detectedType: null,
        errors: [
          {
            path: "$",
            severity: "error",
            message: `Invalid JSON syntax: ${err instanceof Error ? err.message : "parse error"}`,
          },
        ],
        warnings: [],
        normalizedJsonLd: null,
        scriptTagSnippet: null,
      };
    }
  }

  if (!isRecord(parsed)) {
    return {
      valid: false,
      detectedType: null,
      errors: [
        {
          path: "$",
          severity: "error",
          message: "Root JSON-LD value must be a JSON object.",
        },
      ],
      warnings: [],
      normalizedJsonLd: null,
      scriptTagSnippet: null,
    };
  }

  const context = parsed["@context"];
  if (
    typeof context !== "string" ||
    !context.replace(/\/+$/, "").match(/^https?:\/\/schema\.org$/i)
  ) {
    errors.push({
      path: "@context",
      severity: "error",
      message: '`@context` must be `"https://schema.org"`.',
    });
  }

  const schemaType = isNonEmptyString(parsed["@type"]) ? parsed["@type"].trim() : null;
  if (!schemaType) {
    errors.push({
      path: "@type",
      severity: "error",
      message: "Missing required `@type` property.",
    });
    return {
      valid: false,
      detectedType: null,
      errors,
      warnings,
      normalizedJsonLd: parsed,
      scriptTagSnippet: null,
    };
  }

  if (!SUPPORTED_SCHEMA_TYPES.includes(schemaType as SupportedSchemaType)) {
    warnings.push({
      path: "@type",
      severity: "warning",
      message: `Schema type '${schemaType}' is not in the 8 primary Rich Result validators (${SUPPORTED_SCHEMA_TYPES.join(", ")}); only base JSON-LD checks were applied.`,
    });
  }

  // White-hat check: warn if unverified AggregateRating is injected
  if (isRecord(parsed.aggregateRating)) {
    warnings.push({
      path: "aggregateRating",
      severity: "warning",
      message:
        "Ensure `aggregateRating` reflects genuine, verifiable user reviews visible on the page (Google Search Essentials policy).",
    });
  }

  switch (schemaType as SupportedSchemaType) {
    case "Article": {
      if (!isNonEmptyString(parsed.headline)) {
        errors.push({
          path: "headline",
          severity: "error",
          message: "Article requires a non-empty `headline`.",
        });
      } else if (parsed.headline.length > 110) {
        warnings.push({
          path: "headline",
          severity: "warning",
          message: "Article `headline` exceeds 110 characters and may be truncated.",
        });
      }

      if (!isNonEmptyString(parsed.datePublished)) {
        errors.push({
          path: "datePublished",
          severity: "error",
          message: "Article requires `datePublished` in ISO 8601 format.",
        });
      }

      const author = parsed.author;
      const validAuthor =
        (isRecord(author) && isNonEmptyString(author.name)) ||
        (Array.isArray(author) &&
          author.length > 0 &&
          isRecord(author[0]) &&
          isNonEmptyString(author[0].name));
      if (!validAuthor) {
        errors.push({
          path: "author.name",
          severity: "error",
          message: "Article requires `author.name` (Person or Organization).",
        });
      }

      if (!parsed.image) {
        warnings.push({
          path: "image",
          severity: "warning",
          message: "Recommended property `image` is missing for Article rich results.",
        });
      }
      if (!parsed.dateModified) {
        warnings.push({
          path: "dateModified",
          severity: "warning",
          message: "Recommended property `dateModified` is missing.",
        });
      }
      break;
    }

    case "FAQPage": {
      if (!Array.isArray(parsed.mainEntity) || parsed.mainEntity.length === 0) {
        errors.push({
          path: "mainEntity",
          severity: "error",
          message: "FAQPage requires a non-empty `mainEntity` array of Question objects.",
        });
      } else {
        parsed.mainEntity.forEach((item, idx) => {
          if (!isRecord(item) || item["@type"] !== "Question") {
            errors.push({
              path: `mainEntity[${idx}].@type`,
              severity: "error",
              message: "Each FAQ item must have `@type: \"Question\"`.",
            });
          }
          if (!isRecord(item) || !isNonEmptyString(item.name)) {
            errors.push({
              path: `mainEntity[${idx}].name`,
              severity: "error",
              message: "Question item requires a non-empty `name` (the question text).",
            });
          }
          const ans = isRecord(item) ? item.acceptedAnswer : null;
          if (!isRecord(ans) || ans["@type"] !== "Answer" || !isNonEmptyString(ans.text)) {
            errors.push({
              path: `mainEntity[${idx}].acceptedAnswer.text`,
              severity: "error",
              message: "Question item requires `acceptedAnswer` with `@type: \"Answer\"` and non-empty `text`.",
            });
          }
        });
      }
      break;
    }

    case "HowTo": {
      if (!isNonEmptyString(parsed.name)) {
        errors.push({
          path: "name",
          severity: "error",
          message: "HowTo requires a non-empty `name`.",
        });
      }
      if (!Array.isArray(parsed.step) || parsed.step.length < 2) {
        errors.push({
          path: "step",
          severity: "error",
          message: "HowTo requires a `step` array with at least 2 HowToStep items.",
        });
      } else {
        parsed.step.forEach((step, idx) => {
          if (!isRecord(step) || !isNonEmptyString(step.text)) {
            errors.push({
              path: `step[${idx}].text`,
              severity: "error",
              message: "Each HowToStep requires non-empty `text`.",
            });
          }
        });
      }
      break;
    }

    case "Product": {
      if (!isNonEmptyString(parsed.name)) {
        errors.push({
          path: "name",
          severity: "error",
          message: "Product requires a non-empty `name`.",
        });
      }
      const offers = parsed.offers;
      if (!isRecord(offers)) {
        errors.push({
          path: "offers",
          severity: "error",
          message: "Product requires an `offers` object.",
        });
      } else {
        if (!isNonEmptyString(offers.price) && typeof offers.price !== "number") {
          errors.push({
            path: "offers.price",
            severity: "error",
            message: "Product `offers.price` is required.",
          });
        }
        if (!isNonEmptyString(offers.priceCurrency)) {
          errors.push({
            path: "offers.priceCurrency",
            severity: "error",
            message: "Product `offers.priceCurrency` (ISO 4217) is required.",
          });
        }
      }
      break;
    }

    case "SoftwareApplication": {
      if (!isNonEmptyString(parsed.name)) {
        errors.push({
          path: "name",
          severity: "error",
          message: "SoftwareApplication requires a non-empty `name`.",
        });
      }
      if (!isNonEmptyString(parsed.applicationCategory)) {
        errors.push({
          path: "applicationCategory",
          severity: "error",
          message: "SoftwareApplication requires `applicationCategory`.",
        });
      }
      if (!isNonEmptyString(parsed.operatingSystem)) {
        errors.push({
          path: "operatingSystem",
          severity: "error",
          message: "SoftwareApplication requires `operatingSystem`.",
        });
      }
      if (!isRecord(parsed.offers)) {
        errors.push({
          path: "offers",
          severity: "error",
          message: "SoftwareApplication requires an `offers` object with `price` and `priceCurrency`.",
        });
      } else {
        if (parsed.offers.price === undefined || parsed.offers.price === "") {
          errors.push({
            path: "offers.price",
            severity: "error",
            message: "SoftwareApplication `offers.price` is required.",
          });
        }
        if (!isNonEmptyString(parsed.offers.priceCurrency)) {
          errors.push({
            path: "offers.priceCurrency",
            severity: "error",
            message: "SoftwareApplication `offers.priceCurrency` is required.",
          });
        }
      }
      break;
    }

    case "Organization": {
      if (!isNonEmptyString(parsed.name)) {
        errors.push({
          path: "name",
          severity: "error",
          message: "Organization requires a non-empty `name`.",
        });
      }
      if (!isNonEmptyString(parsed.url)) {
        errors.push({
          path: "url",
          severity: "error",
          message: "Organization requires a canonical `url`.",
        });
      }
      if (!isNonEmptyString(parsed.logo) && !isRecord(parsed.logo)) {
        warnings.push({
          path: "logo",
          severity: "warning",
          message: "Organization should include a `logo` URL for Knowledge Panel eligibility.",
        });
      }
      break;
    }

    case "BreadcrumbList": {
      if (!Array.isArray(parsed.itemListElement) || parsed.itemListElement.length === 0) {
        errors.push({
          path: "itemListElement",
          severity: "error",
          message: "BreadcrumbList requires a non-empty `itemListElement` array.",
        });
      } else {
        parsed.itemListElement.forEach((el, idx) => {
          if (!isRecord(el)) {
            errors.push({
              path: `itemListElement[${idx}]`,
              severity: "error",
              message: "Each breadcrumb element must be an object.",
            });
            return;
          }
          if (typeof el.position !== "number") {
            errors.push({
              path: `itemListElement[${idx}].position`,
              severity: "error",
              message: "Breadcrumb ListItem requires numeric `position`.",
            });
          }
          if (!isNonEmptyString(el.name)) {
            errors.push({
              path: `itemListElement[${idx}].name`,
              severity: "error",
              message: "Breadcrumb ListItem requires `name`.",
            });
          }
          if (!isNonEmptyString(el.item)) {
            errors.push({
              path: `itemListElement[${idx}].item`,
              severity: "error",
              message: "Breadcrumb ListItem requires `item` URL.",
            });
          }
        });
      }
      break;
    }

    case "LocalBusiness": {
      if (!isNonEmptyString(parsed.name)) {
        errors.push({
          path: "name",
          severity: "error",
          message: "LocalBusiness requires a non-empty `name`.",
        });
      }
      if (!isNonEmptyString(parsed.telephone)) {
        warnings.push({
          path: "telephone",
          severity: "warning",
          message: "Recommended property `telephone` is missing for LocalBusiness.",
        });
      }
      if (!isRecord(parsed.address)) {
        errors.push({
          path: "address",
          severity: "error",
          message: "LocalBusiness requires a `PostalAddress` object in `address`.",
        });
      } else {
        if (!isNonEmptyString(parsed.address.streetAddress)) {
          errors.push({
            path: "address.streetAddress",
            severity: "error",
            message: "LocalBusiness `address.streetAddress` is required.",
          });
        }
        if (!isNonEmptyString(parsed.address.addressLocality)) {
          errors.push({
            path: "address.addressLocality",
            severity: "error",
            message: "LocalBusiness `address.addressLocality` is required.",
          });
        }
        if (!isNonEmptyString(parsed.address.addressCountry)) {
          errors.push({
            path: "address.addressCountry",
            severity: "error",
            message: "LocalBusiness `address.addressCountry` is required.",
          });
        }
      }
      break;
    }
  }

  const valid = errors.length === 0;
  return {
    valid,
    detectedType: schemaType,
    errors,
    warnings,
    normalizedJsonLd: parsed,
    scriptTagSnippet: valid ? formatJsonLdScriptTag(parsed) : null,
  };
}

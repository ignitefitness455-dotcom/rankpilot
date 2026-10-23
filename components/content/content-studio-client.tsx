"use client";

import * as React from "react";
import {
  CheckCircle2,
  Code2,
  Copy,
  FileText,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import type { ContentItemDto } from "@/lib/content/studio";
import {
  SUPPORTED_SCHEMA_TYPES,
  type SchemaValidationResult,
  type SupportedSchemaType,
} from "@/lib/schema-gen/generator";

export interface ContentStudioClientProps {
  projectId: string;
  projectUrl: string;
  projectName: string;
  initialItems: ContentItemDto[];
}

function getDefaultSchemaFormPayload(
  type: SupportedSchemaType,
  projectName: string,
  projectUrl: string,
): Record<string, unknown> {
  const baseUrl = projectUrl.replace(/\/+$/, "");
  switch (type) {
    case "Article":
      return {
        type: "Article",
        headline: `${projectName} Complete Technical SEO Guide`,
        description:
          "Actionable engineering guide covering crawlability, Core Web Vitals, internal linking, and structured data.",
        url: `${baseUrl}/guides/technical-seo`,
        authorName: `${projectName} Editorial Team`,
        publisherName: projectName,
        datePublished: new Date().toISOString().slice(0, 10),
      };
    case "FAQPage":
      return {
        type: "FAQPage",
        questions: [
          {
            question: "How often should we run a technical SEO audit?",
            answer:
              "Run an automated crawl weekly and after every major production deployment to catch regressions early.",
          },
          {
            question: "Why does JSON-LD structured data matter for AI Search?",
            answer:
              "Structured data disambiguates entities, pricing, authorship, and FAQs for both Google Rich Results and generative answer engines.",
          },
        ],
      };
    case "HowTo":
      return {
        type: "HowTo",
        name: "How to Fix Missing Canonical Tags and Verify Indexation",
        description:
          "Step-by-step workflow to add self-referencing canonical URLs and verify them in Google Search Console.",
        totalTimeIso: "PT20M",
        steps: [
          {
            name: "Audit duplicate and parameterized URLs",
            text: "Identify pages missing <link rel=\"canonical\"> in your RankPilot Site Audit report.",
          },
          {
            name: "Add absolute canonical tags to page metadata",
            text: "Output an absolute https:// canonical link in your page <head> template and re-verify.",
          },
        ],
      };
    case "Product":
      return {
        type: "Product",
        name: `${projectName} Pro Plan`,
        description:
          "Autonomous AI SEO workspace with technical crawl audits, Search Console intelligence, and GEO tracking.",
        brandName: projectName,
        price: "49.00",
        priceCurrency: "USD",
        availability: "InStock",
        url: `${baseUrl}/pricing`,
      };
    case "SoftwareApplication":
      return {
        type: "SoftwareApplication",
        name: projectName,
        description:
          "Self-hostable AI SEO Agent powered by Gemini 4 Argon for developers, bloggers, and SaaS teams.",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, Windows, macOS, Linux",
        price: "0",
        priceCurrency: "USD",
        url: baseUrl,
      };
    case "Organization":
      return {
        type: "Organization",
        name: projectName,
        url: baseUrl,
        logoUrl: `${baseUrl}/icon-512.png`,
        description: `Official website and documentation for ${projectName}.`,
      };
    case "BreadcrumbList":
      return {
        type: "BreadcrumbList",
        items: [
          { name: "Home", itemUrl: baseUrl },
          { name: "Guides", itemUrl: `${baseUrl}/guides` },
          { name: "Technical SEO", itemUrl: `${baseUrl}/guides/technical-seo` },
        ],
      };
    case "LocalBusiness":
      return {
        type: "LocalBusiness",
        name: projectName,
        url: baseUrl,
        telephone: "+1-555-019-2834",
        priceRange: "$$",
        streetAddress: "100 Market Street, Suite 400",
        addressLocality: "San Francisco",
        addressRegion: "CA",
        postalCode: "94105",
        addressCountry: "US",
      };
  }
}

export function ContentStudioClient({
  projectId,
  projectUrl,
  projectName,
  initialItems,
}: ContentStudioClientProps) {
  const [activeTab, setActiveTab] = React.useState<"studio" | "schema">("studio");
  const [items, setItems] = React.useState<ContentItemDto[]>(initialItems);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialItems[0]?.id ?? null,
  );

  const selectedItem = React.useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  const [newKeyword, setNewKeyword] = React.useState("");
  const [newTitle, setNewTitle] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const [editorBody, setEditorBody] = React.useState<string>(
    initialItems[0]?.versions[0]?.bodyMd ?? "",
  );
  const [editorStatus, setEditorStatus] = React.useState<
    "draft" | "in_review" | "approved" | "archived"
  >(initialItems[0]?.status ?? "draft");
  const [savingVersion, setSavingVersion] = React.useState(false);
  const [regenerating, setRegenerating] = React.useState(false);
  const [studioToast, setStudioToast] = React.useState<string | null>(null);

  // Schema Generator state
  const [schemaType, setSchemaType] = React.useState<SupportedSchemaType>("Article");
  const [schemaPayloadJson, setSchemaPayloadJson] = React.useState<string>(() =>
    JSON.stringify(
      getDefaultSchemaFormPayload("Article", projectName, projectUrl),
      null,
      2,
    ),
  );
  const [generatedSnippet, setGeneratedSnippet] = React.useState<string | null>(null);
  const [schemaValidation, setSchemaValidation] =
    React.useState<SchemaValidationResult | null>(null);
  const [schemaError, setSchemaError] = React.useState<string | null>(null);

  function selectContentItem(item: ContentItemDto) {
    setSelectedId(item.id);
    setEditorBody(item.versions[0]?.bodyMd ?? "");
    setEditorStatus(item.status);
  }

  async function handleCreateContent(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    setCreating(true);
    setStudioToast(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetKeyword: newKeyword.trim(),
          title: newTitle.trim() || undefined,
          generateInitialDraft: true,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { item: ContentItemDto };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Failed to create content brief");
      }
      const created = json.data.item;
      setItems((prev) => [created, ...prev]);
      selectContentItem(created);
      setNewKeyword("");
      setNewTitle("");
      setStudioToast("Created Content Brief & Version 1 E-E-A-T Draft.");
    } catch (err) {
      setStudioToast(err instanceof Error ? err.message : "Failed to create brief");
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveVersion() {
    if (!selectedItem) return;
    setSavingVersion(true);
    setStudioToast(null);
    try {
      const res = await fetch(`/api/v1/content/${selectedItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editorStatus,
          bodyMd: editorBody,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { item: ContentItemDto };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Failed to save draft version");
      }
      const updated = json.data.item;
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setStudioToast(
        `Saved v${updated.versions[0]?.version ?? 1} & re-evaluated SEO + 8-gram Originality.`,
      );
    } catch (err) {
      setStudioToast(err instanceof Error ? err.message : "Failed to save version");
    } finally {
      setSavingVersion(false);
    }
  }

  async function handleRegenerateDraft() {
    if (!selectedItem) return;
    setRegenerating(true);
    setStudioToast(null);
    try {
      const res = await fetch(`/api/v1/content/${selectedItem.id}/draft`, {
        method: "POST",
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { item: ContentItemDto };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Failed to generate draft");
      }
      const updated = json.data.item;
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      selectContentItem(updated);
      setStudioToast(`Generated fresh E-E-A-T draft (v${updated.versions[0]?.version ?? 1}).`);
    } catch (err) {
      setStudioToast(err instanceof Error ? err.message : "Failed to generate draft");
    } finally {
      setRegenerating(false);
    }
  }

  function handleSelectSchemaType(nextType: SupportedSchemaType) {
    setSchemaType(nextType);
    setSchemaPayloadJson(
      JSON.stringify(
        getDefaultSchemaFormPayload(nextType, projectName, projectUrl),
        null,
        2,
      ),
    );
    setGeneratedSnippet(null);
    setSchemaValidation(null);
    setSchemaError(null);
  }

  async function handleGenerateSchema() {
    setSchemaError(null);
    try {
      const parsed = JSON.parse(schemaPayloadJson) as Record<string, unknown>;
      const res = await fetch("/api/v1/schema/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...parsed, type: schemaType }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: {
          jsonLd: Record<string, unknown>;
          scriptTagSnippet: string;
          validation: SchemaValidationResult;
        };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Schema generation failed");
      }
      setGeneratedSnippet(json.data.scriptTagSnippet);
      setSchemaValidation(json.data.validation);
    } catch (err) {
      setSchemaError(
        err instanceof Error ? err.message : "Invalid schema input JSON",
      );
    }
  }

  async function handleValidateRawSchema() {
    setSchemaError(null);
    try {
      const targetText = generatedSnippet ?? schemaPayloadJson;
      const res = await fetch("/api/v1/schema/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonLd: targetText }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { validation: SchemaValidationResult };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Schema validation failed");
      }
      setSchemaValidation(json.data.validation);
    } catch (err) {
      setSchemaError(err instanceof Error ? err.message : "Validation error");
    }
  }

  const latestVersion = selectedItem?.versions[0] ?? null;
  const originality = latestVersion?.originality ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)]">
            Content Studio &amp; JSON-LD Schema Generator
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Generate evidence-backed content briefs, write human-in-the-loop E-E-A-T drafts with 8-gram shingle originality verification, and build validated Rich Result JSON-LD.
          </p>
        </div>

        <div className="inline-flex rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-1">
          <button
            type="button"
            onClick={() => setActiveTab("studio")}
            className={`inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === "studio"
                ? "bg-[var(--brand)] text-white"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            Briefs &amp; E-E-A-T Editor ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("schema")}
            className={`inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === "schema"
                ? "bg-[var(--brand)] text-white"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            Schema Generator (8 Types)
          </button>
        </div>
      </div>

      {activeTab === "studio" ? (
        <div className="space-y-6">
          {/* Create Brief & Draft Form */}
          <Card className="space-y-3">
            <form
              onSubmit={handleCreateContent}
              className="grid gap-3 sm:grid-cols-3"
            >
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="Target keyword (e.g. core web vitals optimization)"
                className="h-10 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg)] focus:border-[var(--brand)] focus:outline-none"
              />
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Custom article headline (optional)"
                className="h-10 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg)] focus:border-[var(--brand)] focus:outline-none"
              />
              <Button type="submit" disabled={creating}>
                <Plus className="h-4 w-4" />
                {creating
                  ? "Generating Brief & E-E-A-T Draft..."
                  : "Create Brief & E-E-A-T Draft"}
              </Button>
            </form>
            {studioToast && (
              <p className="text-xs font-medium text-[var(--brand)]">
                {studioToast}
              </p>
            )}
          </Card>

          {items.length === 0 ? (
            <Card className="py-12 text-center">
              <p className="text-sm text-[var(--fg-muted)]">
                No content briefs or drafts yet. Enter a target keyword above to generate your first evidence-backed Content Brief and E-E-A-T draft.
              </p>
            </Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-12">
              {/* Left Sidebar: Content Items List */}
              <div className="space-y-2.5 lg:col-span-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
                  Project Briefs &amp; Articles ({items.length})
                </h2>
                {items.map((item) => {
                  const isSelected = item.id === selectedItem?.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectContentItem(item)}
                      className={`w-full rounded-[10px] border p-3 text-left transition ${
                        isSelected
                          ? "border-[var(--brand)] bg-[var(--brand-subtle)]/30"
                          : "border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--brand)]/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge
                          variant={
                            item.status === "approved"
                              ? "good"
                              : item.status === "in_review"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {item.status}
                        </Badge>
                        {item.seoScore !== null && (
                          <span className="font-mono text-xs font-bold text-[var(--brand)]">
                            SEO {item.seoScore}/100
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-xs font-semibold text-[var(--fg)]">
                        {item.title}
                      </p>
                      {item.targetKeyword && (
                        <p className="mt-1 font-mono text-[11px] text-[var(--fg-muted)]">
                          KW: {item.targetKeyword}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Center Pane: Brief Overview & Markdown Editor */}
              {selectedItem && (
                <div className="space-y-4 lg:col-span-6">
                  {selectedItem.brief && (
                    <Card className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-[var(--fg)]">
                          Content Brief: {selectedItem.brief.targetKeyword}
                        </h3>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="info">
                            {selectedItem.brief.intent}
                          </Badge>
                          <Badge variant="neutral">
                            Target: {selectedItem.brief.recommendedWordCount.min}–
                            {selectedItem.brief.recommendedWordCount.max} words
                          </Badge>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5 text-xs">
                        {selectedItem.brief.entitiesToCover.map((entity) => (
                          <Badge key={entity} variant="brand">
                            {entity}
                          </Badge>
                        ))}
                      </div>

                      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-xs">
                        <p className="font-semibold text-[var(--fg)]">
                          Mandatory Human E-E-A-T Prompts:
                        </p>
                        <ul className="mt-1 space-y-1 text-[var(--fg-muted)]">
                          {selectedItem.brief.eeatExperiencePrompts.map((p, i) => (
                            <li key={i} className="font-mono text-[11px]">
                              • {p}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </Card>
                  )}

                  <Card className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-[var(--fg)]">
                          Markdown Article Editor
                        </h3>
                        {selectedItem.versions.length > 0 && (
                          <select
                            aria-label="Select version"
                            onChange={(e) => {
                              const ver = selectedItem.versions.find(
                                (v) => v.id === e.target.value,
                              );
                              if (ver) setEditorBody(ver.bodyMd);
                            }}
                            className="h-7 rounded border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-xs text-[var(--fg)]"
                          >
                            {selectedItem.versions.map((v) => (
                              <option key={v.id} value={v.id}>
                                v{v.version} ({v.author})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label="Approval status"
                          value={editorStatus}
                          onChange={(e) =>
                            setEditorStatus(
                              e.target.value as
                                | "draft"
                                | "in_review"
                                | "approved"
                                | "archived",
                            )
                          }
                          className="h-8 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--fg)]"
                        >
                          <option value="draft">Draft</option>
                          <option value="in_review">In Review</option>
                          <option value="approved">Approved</option>
                          <option value="archived">Archived</option>
                        </select>

                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={handleRegenerateDraft}
                          disabled={regenerating}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          {regenerating ? "Generating..." : "Regenerate"}
                        </Button>

                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            void navigator.clipboard.writeText(editorBody);
                            setStudioToast("Copied Markdown draft to clipboard.");
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy MD
                        </Button>

                        <Button
                          size="sm"
                          onClick={handleSaveVersion}
                          disabled={savingVersion}
                        >
                          <Save className="h-3.5 w-3.5" />
                          {savingVersion ? "Saving..." : "Save Version"}
                        </Button>
                      </div>
                    </div>

                    <textarea
                      aria-label="Article Markdown Body"
                      rows={22}
                      value={editorBody}
                      onChange={(e) => setEditorBody(e.target.value)}
                      className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs leading-relaxed text-[var(--fg)] focus:border-[var(--brand)] focus:outline-none"
                    />
                  </Card>
                </div>
              )}

              {/* Right Pane: Live SEO Score, Checklist & 8-gram Originality Guardrail */}
              {selectedItem && (
                <div className="space-y-4 lg:col-span-3">
                  {/* Originality & Anti-Stuffing Guardrail */}
                  <Card className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="h-4 w-4 text-[var(--good)]" />
                        <h3 className="text-sm font-bold text-[var(--fg)]">
                          Originality Guardrail
                        </h3>
                      </div>
                      <Badge
                        variant={
                          originality?.passed !== false ? "good" : "critical"
                        }
                      >
                        {originality ? `${originality.score}/100` : "100/100"}
                      </Badge>
                    </div>

                    {originality ? (
                      <div className="space-y-1.5 text-xs text-[var(--fg-muted)]">
                        <p className="flex justify-between">
                          <span>8-Gram Shingle Overlap:</span>
                          <strong className="font-mono text-[var(--fg)]">
                            {(originality.overlapRatio * 100).toFixed(1)}%
                          </strong>
                        </p>
                        <p className="flex justify-between">
                          <span>Max Keyword Density:</span>
                          <strong
                            className={`font-mono ${
                              originality.keywordStuffingFlag
                                ? "text-[var(--crit)]"
                                : "text-[var(--fg)]"
                            }`}
                          >
                            {originality.maxKeywordDensityPct}%
                          </strong>
                        </p>
                        <p className="flex justify-between">
                          <span>E-E-A-T Prompts to Fill:</span>
                          <strong className="font-mono text-[var(--warn)]">
                            {originality.eeatPlaceholdersRemaining}
                          </strong>
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--fg-muted)]">
                        Save or generate a draft to run 8-gram shingle verification.
                      </p>
                    )}
                  </Card>

                  {/* Live SEO Checklist */}
                  <Card className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-[var(--fg)]">
                        SEO &amp; GEO Checklist
                      </h3>
                      <Badge variant="brand">
                        {selectedItem.seoScore ?? 0}/100
                      </Badge>
                    </div>

                    <div className="space-y-2.5">
                      {selectedItem.checklist.map((chk) => (
                        <div
                          key={chk.id}
                          className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-xs"
                        >
                          <div className="flex items-start gap-2">
                            {chk.passed ? (
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--good)]" />
                            ) : (
                              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warn)]" />
                            )}
                            <div>
                              <p className="font-semibold text-[var(--fg)]">
                                {chk.label}
                              </p>
                              <p className="mt-0.5 text-[11px] text-[var(--fg-muted)]">
                                {chk.detail}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Tab 2: JSON-LD Schema Generator & Validator (8 Supported Types) */
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-[var(--fg)]">
                1. Select Schema.org Rich Result Type
              </h2>
              <Badge variant="brand">8 Validated Types</Badge>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {SUPPORTED_SCHEMA_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleSelectSchemaType(t)}
                  className={`rounded-[6px] border px-2.5 py-1 font-mono text-xs font-medium transition ${
                    schemaType === t
                      ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:border-[var(--brand)]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="schema-input-editor"
                className="block text-xs font-semibold text-[var(--fg)]"
              >
                Input Properties for <code className="font-mono">{schemaType}</code> (JSON)
              </label>
              <textarea
                id="schema-input-editor"
                rows={14}
                value={schemaPayloadJson}
                onChange={(e) => setSchemaPayloadJson(e.target.value)}
                className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs text-[var(--fg)] focus:border-[var(--brand)] focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleGenerateSchema}>
                <Sparkles className="h-4 w-4" />
                Generate &amp; Validate JSON-LD
              </Button>
              <Button variant="secondary" onClick={handleValidateRawSchema}>
                <ShieldCheck className="h-4 w-4" />
                Validate Current Snippet
              </Button>
            </div>
            {schemaError && (
              <p className="text-xs text-[var(--crit)]">{schemaError}</p>
            )}
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[var(--fg)]">
                2. Ready-to-Paste JSON-LD &amp; Validation Report
              </h2>
              {generatedSnippet && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(generatedSnippet);
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy &lt;script&gt;
                </Button>
              )}
            </div>

            {schemaValidation && (
              <div className="space-y-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--fg)]">
                    Validation Status ({schemaValidation.detectedType ?? schemaType}):
                  </span>
                  <Badge variant={schemaValidation.valid ? "good" : "critical"}>
                    {schemaValidation.valid
                      ? "VALID — Ready for Production"
                      : `${schemaValidation.errors.length} Error(s)`}
                  </Badge>
                </div>

                {schemaValidation.errors.map((err, i) => (
                  <p key={i} className="font-mono text-[var(--crit)]">
                    [ERROR] {err.path}: {err.message}
                  </p>
                ))}
                {schemaValidation.warnings.map((w, i) => (
                  <p key={i} className="font-mono text-[var(--warn)]">
                    [WARN] {w.path}: {w.message}
                  </p>
                ))}
              </div>
            )}

            <pre className="max-h-96 overflow-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs text-[var(--fg)]">
              {generatedSnippet ??
                "// Click 'Generate & Validate JSON-LD' to build the <script type=\"application/ld+json\"> snippet."}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "@/lib/i18n/routing";
import { Button, Card, Input, Select, Textarea } from "@/components/ui/primitives";

export interface OnboardingFormStrings {
  title: string;
  subtitle: string;
  step1: string;
  step2: string;
  projectNameLabel: string;
  projectNamePlaceholder: string;
  websiteUrlLabel: string;
  websiteUrlPlaceholder: string;
  cmsLabel: string;
  cmsPlaceholder: string;
  siteTypeLabel: string;
  siteTypes: Record<string, string>;
  nicheLabel: string;
  nichePlaceholder: string;
  countriesLabel: string;
  languagesLabel: string;
  competitorsLabel: string;
  brandVoiceLabel: string;
  audienceLabel: string;
  goalsLabel: string;
  createButton: string;
  creating: string;
}

export function OnboardingForm({ strings }: { strings: OnboardingFormStrings }) {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("https://");
  const [cms, setCms] = React.useState("Next.js");
  const [siteType, setSiteType] = React.useState("saas");
  const [niche, setNiche] = React.useState("Software & SaaS");
  const [countries, setCountries] = React.useState("US, BD");
  const [languages, setLanguages] = React.useState("en, bn");
  const [competitors, setCompetitors] = React.useState("");
  const [brandVoice, setBrandVoice] = React.useState(
    "Clear, helpful, plain-language, trustworthy",
  );
  const [audience, setAudience] = React.useState(
    "Solo founders and builders looking for actionable answers",
  );
  const [goals, setGoals] = React.useState("Grow organic traffic and signups");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          url,
          cms,
          language: languages.split(",")[0]?.trim() || "en",
          profile: {
            siteType,
            niche,
            countries: countries
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            languages: languages
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            competitorHosts: competitors
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 5),
            brandVoice,
            audience,
            goals,
            constraints: "White-hat only; human approval before any change",
          },
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) {
        throw new Error(payload?.error?.message || "Failed to create project");
      }
      router.push(`/p/${payload.data.project.id}/dashboard`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="space-y-4">
        <h2 className="text-base font-semibold text-[var(--fg)]">{strings.step1}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="project-name" className="text-xs font-medium text-[var(--fg)]">
              {strings.projectNameLabel}
            </label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={strings.projectNamePlaceholder}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="project-url" className="text-xs font-medium text-[var(--fg)]">
              {strings.websiteUrlLabel}
            </label>
            <Input
              id="project-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={strings.websiteUrlPlaceholder}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="project-cms" className="text-xs font-medium text-[var(--fg)]">
              {strings.cmsLabel}
            </label>
            <Input
              id="project-cms"
              value={cms}
              onChange={(e) => setCms(e.target.value)}
              placeholder={strings.cmsPlaceholder}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="project-site-type" className="text-xs font-medium text-[var(--fg)]">
              {strings.siteTypeLabel}
            </label>
            <Select
              id="project-site-type"
              value={siteType}
              onChange={(e) => setSiteType(e.target.value)}
            >
              {Object.entries(strings.siteTypes).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-base font-semibold text-[var(--fg)]">{strings.step2}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="project-niche" className="text-xs font-medium text-[var(--fg)]">
              {strings.nicheLabel}
            </label>
            <Input
              id="project-niche"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder={strings.nichePlaceholder}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="project-countries" className="text-xs font-medium text-[var(--fg)]">
              {strings.countriesLabel}
            </label>
            <Input
              id="project-countries"
              value={countries}
              onChange={(e) => setCountries(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="project-languages" className="text-xs font-medium text-[var(--fg)]">
              {strings.languagesLabel}
            </label>
            <Input
              id="project-languages"
              value={languages}
              onChange={(e) => setLanguages(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="project-competitors" className="text-xs font-medium text-[var(--fg)]">
            {strings.competitorsLabel}
          </label>
          <Input
            id="project-competitors"
            value={competitors}
            onChange={(e) => setCompetitors(e.target.value)}
            placeholder="competitor1.com, competitor2.com"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="project-voice" className="text-xs font-medium text-[var(--fg)]">
              {strings.brandVoiceLabel}
            </label>
            <Textarea
              id="project-voice"
              value={brandVoice}
              onChange={(e) => setBrandVoice(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="project-audience" className="text-xs font-medium text-[var(--fg)]">
              {strings.audienceLabel}
            </label>
            <Textarea
              id="project-audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="project-goals" className="text-xs font-medium text-[var(--fg)]">
              {strings.goalsLabel}
            </label>
            <Textarea
              id="project-goals"
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" size="lg" disabled={submitting} data-testid="create-project-submit">
            {submitting ? strings.creating : strings.createButton}
          </Button>
        </div>
      </Card>
    </form>
  );
}

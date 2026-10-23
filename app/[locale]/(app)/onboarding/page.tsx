import { getTranslations } from "next-intl/server";
import { OnboardingForm } from "@/components/projects/onboarding-form";

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "onboarding" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)]">{t("title")}</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">{t("subtitle")}</p>
      </div>

      <OnboardingForm
        strings={{
          title: t("title"),
          subtitle: t("subtitle"),
          step1: t("step1"),
          step2: t("step2"),
          projectNameLabel: t("projectNameLabel"),
          projectNamePlaceholder: t("projectNamePlaceholder"),
          websiteUrlLabel: t("websiteUrlLabel"),
          websiteUrlPlaceholder: t("websiteUrlPlaceholder"),
          cmsLabel: t("cmsLabel"),
          cmsPlaceholder: t("cmsPlaceholder"),
          siteTypeLabel: t("siteTypeLabel"),
          siteTypes: {
            saas: t("siteTypes.saas"),
            blog: t("siteTypes.blog"),
            online_tools: t("siteTypes.online_tools"),
            ecommerce: t("siteTypes.ecommerce"),
            local_business: t("siteTypes.local_business"),
            other: t("siteTypes.other"),
          },
          nicheLabel: t("nicheLabel"),
          nichePlaceholder: t("nichePlaceholder"),
          countriesLabel: t("countriesLabel"),
          languagesLabel: t("languagesLabel"),
          competitorsLabel: t("competitorsLabel"),
          brandVoiceLabel: t("brandVoiceLabel"),
          audienceLabel: t("audienceLabel"),
          goalsLabel: t("goalsLabel"),
          createButton: t("createButton"),
          creating: t("creating"),
        }}
      />
    </div>
  );
}

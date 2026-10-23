import { ArrowRight, CheckCircle2, Globe, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { Link } from "@/lib/i18n/routing";
import { Badge, Button, Card } from "@/components/ui/primitives";

export default async function PublicLandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });
  const tNav = await getTranslations({ locale, namespace: "nav" });
  const session = await auth();
  const nextHref = session?.user?.id ? "/onboarding" : "/sign-in";

  return (
    <div className="min-h-dvh flex flex-col bg-[var(--bg)]">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2 font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--brand)] text-sm font-bold text-white">
            R
          </span>
          <span className="text-base tracking-tight">RankPilot</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            locale={locale === "en" ? "bn" : "en"}
            className="rounded-[8px] border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            {locale === "en" ? "বাংলা" : "English"}
          </Link>
          <Link href={nextHref}>
            <Button size="sm">{session?.user?.id ? t("ctaStart") : tNav("signIn")}</Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto flex flex-1 max-w-5xl flex-col justify-center px-6 py-12">
        <div className="space-y-6 text-center">
          <Badge variant="brand" className="mx-auto">
            <span>{t("badge")}</span>
          </Badge>
          <h1 className="mx-auto max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
            {t("heroTitle")}
          </h1>
          <p className="mx-auto max-w-2xl text-base text-[var(--fg-muted)] sm:text-lg leading-relaxed">
            {t("heroSubtitle")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link href={nextHref}>
              <Button size="lg">
                <span>{t("ctaStart")}</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/bot">
              <Button variant="outline" size="lg">
                {t("ctaBotInfo")}
              </Button>
            </Link>
          </div>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-3">
          <Card className="space-y-2">
            <CheckCircle2 className="h-5 w-5 text-[var(--good)]" />
            <h2 className="text-base font-semibold">{t("pillar1Title")}</h2>
            <p className="text-xs leading-relaxed text-[var(--fg-muted)]">{t("pillar1Body")}</p>
          </Card>
          <Card className="space-y-2">
            <ShieldCheck className="h-5 w-5 text-[var(--brand)]" />
            <h2 className="text-base font-semibold">{t("pillar2Title")}</h2>
            <p className="text-xs leading-relaxed text-[var(--fg-muted)]">{t("pillar2Body")}</p>
          </Card>
          <Card className="space-y-2">
            <Globe className="h-5 w-5 text-[var(--info)]" />
            <h2 className="text-base font-semibold">{t("pillar3Title")}</h2>
            <p className="text-xs leading-relaxed text-[var(--fg-muted)]">{t("pillar3Body")}</p>
          </Card>
        </div>
      </main>
    </div>
  );
}

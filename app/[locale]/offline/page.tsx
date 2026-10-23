import { WifiOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/routing";
import { Button, Card } from "@/components/ui/primitives";

export default async function OfflinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Card className="max-w-md text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--warning-bg)] text-[var(--warning)]">
          <WifiOff className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold text-[var(--fg)]">{t("offlineTitle")}</h1>
        <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
          {t("offlineDescription")}
        </p>
        <div>
          <Link href="/">
            <Button>{t("retry")}</Button>
          </Link>
        </div>
      </Card>
    </main>
  );
}

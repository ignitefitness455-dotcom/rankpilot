import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { getEnv } from "@/lib/security/env";
import { getUserProjects } from "@/lib/projects/service";
import { Button, Card, Input } from "@/components/ui/primitives";

export default async function SignInPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (session?.user?.id) {
    const userProjects = await getUserProjects(session.user.id);
    if (userProjects.length > 0) {
      redirect(`/${locale}/p/${userProjects[0]!.project.id}/dashboard`);
    }
    redirect(`/${locale}/onboarding`);
  }

  const t = await getTranslations({ locale, namespace: "auth" });
  const env = getEnv();
  const hasGoogle = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
  const hasDevLogin = env.AUTH_DEV_LOGIN && env.NODE_ENV !== "production";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--surface)] p-6">
      <Card className="w-full max-w-md space-y-6">
        <div className="space-y-1.5 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-[12px] bg-[var(--brand)] text-base font-bold text-white">
            R
          </div>
          <h1 className="text-xl font-bold text-[var(--fg)]">{t("signInTitle")}</h1>
          <p className="text-xs text-[var(--fg-muted)]">{t("signInSubtitle")}</p>
        </div>

        {hasGoogle && (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: `/${locale}/onboarding` });
            }}
          >
            <Button type="submit" variant="outline" className="w-full">
              {t("googleSignIn")}
            </Button>
          </form>
        )}

        {hasDevLogin && (
          <form
            action={async (formData: FormData) => {
              "use server";
              const email = String(formData.get("email") || "founder@rankpilot.local");
              const name = String(formData.get("name") || "Solo Site Owner");
              await signIn("dev-login", {
                email,
                name,
                redirectTo: `/${locale}/onboarding`,
              });
            }}
            className="space-y-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <div>
              <h2 className="text-sm font-semibold text-[var(--fg)]">{t("devLoginTitle")}</h2>
              <p className="text-[11px] text-[var(--fg-muted)]">{t("devLoginHint")}</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="dev-email" className="text-xs font-medium text-[var(--fg)]">
                {t("emailLabel")}
              </label>
              <Input
                id="dev-email"
                name="email"
                type="email"
                defaultValue="founder@rankpilot.local"
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="dev-name" className="text-xs font-medium text-[var(--fg)]">
                {t("nameLabel")}
              </label>
              <Input
                id="dev-name"
                name="name"
                type="text"
                defaultValue="Solo Site Owner"
                required
              />
            </div>
            <Button type="submit" className="w-full" data-testid="dev-signin-submit">
              {t("devSignInButton")}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}

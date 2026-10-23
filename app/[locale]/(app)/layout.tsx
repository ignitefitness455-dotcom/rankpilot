import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { getUserProjects } from "@/lib/projects/service";
import { getOrCreateUserSettings } from "@/lib/settings/service";
import { AppShell } from "@/components/layout/app-shell";

export default async function AuthenticatedAppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/${locale}/sign-in`);
  }

  const [userProjects, settings, tApp, tNav, tTop, tAgent] = await Promise.all([
    getUserProjects(session.user.id),
    getOrCreateUserSettings(session.user.id),
    getTranslations({ locale, namespace: "app" }),
    getTranslations({ locale, namespace: "nav" }),
    getTranslations({ locale, namespace: "topbar" }),
    getTranslations({ locale, namespace: "agentDrawer" }),
  ]);

  const projectItems = userProjects.map(({ project }) => ({
    id: project.id,
    name: project.name,
    host: project.host,
    verified: Boolean(project.verifiedAt),
  }));

  return (
    <AppShell
      user={{
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
      }}
      projects={projectItems}
      activeProjectId={projectItems[0]?.id ?? null}
      budgetRunUsd={settings.budgetRunUsd}
      profileVersion={1}
      strings={{
        skipToContent: tApp("skipToContent"),
        nav: {
          placeholder: tTop("searchPlaceholder"),
          dashboard: tNav("dashboard"),
          audit: tNav("audit"),
          pages: tNav("pages"),
          keywords: tNav("keywords"),
          competitors: tNav("competitors"),
          content: tNav("content"),
          aiSearch: tNav("aiSearch"),
          actions: tNav("actions"),
          reports: tNav("reports"),
          projectSettings: tNav("projectSettings"),
          accountSettings: tNav("accountSettings"),
          onboarding: tNav("onboarding"),
          askAgent: tNav("askAgent"),
          themeLight: tTop("themeLight"),
          themeDark: tTop("themeDark"),
          language: tTop("language"),
          collapseSidebar: tNav("collapseSidebar"),
          expandSidebar: tNav("expandSidebar"),
          signOut: tNav("signOut"),
          more: tNav("more"),
        },
        topbar: {
          selectProject: tTop("selectProject"),
          newProject: tTop("newProject"),
          searchPlaceholder: tTop("searchPlaceholder"),
          notifications: tTop("notifications"),
          noAlerts: tTop("noAlerts"),
          themeLight: tTop("themeLight"),
          themeDark: tTop("themeDark"),
          themeSystem: tTop("themeSystem"),
          language: tTop("language"),
          openAgentDrawer: tTop("openAgentDrawer"),
        },
        agentDrawer: {
          title: tAgent("title"),
          modelBadge: tAgent("modelBadge"),
          close: tAgent("close"),
          phaseNoticeTitle: tAgent("phaseNoticeTitle"),
          phaseNoticeBody: tAgent("phaseNoticeBody"),
          cachedPrefixReady: tAgent("cachedPrefixReady"),
          budgetCapLabel: tAgent("budgetCapLabel"),
          ConfigureKeyCta: tAgent("ConfigureKeyCta"),
          inputPlaceholder: tAgent("inputPlaceholder"),
        },
      }}
    >
      {children}
    </AppShell>
  );
}

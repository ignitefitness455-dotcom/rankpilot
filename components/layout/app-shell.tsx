"use client";

import * as React from "react";
import {
  Activity,
  Bot,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PlusCircle,
  Search,
  Settings,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useLocale } from "next-intl";
import { signOut } from "next-auth/react";
import { Link, usePathname, useRouter } from "@/lib/i18n/routing";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { CommandPalette, type CommandPaletteStrings } from "./command-palette";
import { AgentDrawer, type AgentDrawerStrings } from "@/components/agent/agent-drawer";

export interface ProjectSummaryItem {
  id: string;
  name: string;
  host: string;
  verified: boolean;
}

export interface AppShellProps {
  children: React.ReactNode;
  user: { id: string; name: string | null; email: string | null };
  projects: ProjectSummaryItem[];
  activeProjectId: string | null;
  budgetRunUsd: number;
  profileVersion: number | null;
  strings: {
    skipToContent: string;
    nav: CommandPaletteStrings & {
      collapseSidebar: string;
      expandSidebar: string;
      signOut: string;
      more: string;
    };
    topbar: {
      selectProject: string;
      newProject: string;
      searchPlaceholder: string;
      notifications: string;
      noAlerts: string;
      themeLight: string;
      themeDark: string;
      themeSystem: string;
      language: string;
      openAgentDrawer: string;
    };
    agentDrawer: AgentDrawerStrings;
  };
}

export function AppShell({
  children,
  user,
  projects,
  activeProjectId,
  budgetRunUsd,
  profileVersion,
  strings,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const { resolvedTheme, setTheme } = useTheme();

  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const [agentOpen, setAgentOpen] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const pathProjectMatch = pathname.match(/^\/p\/([0-9a-f-]{36})/i);
  const currentProjectId = pathProjectMatch?.[1] ?? activeProjectId ?? projects[0]?.id ?? null;
  const pBase = currentProjectId ? `/p/${currentProjectId}` : null;

  const navItems = pBase
    ? [
        { href: `${pBase}/dashboard`, label: strings.nav.dashboard, Icon: LayoutDashboard },
        { href: `${pBase}/audit`, label: strings.nav.audit, Icon: Activity },
        { href: `${pBase}/pages`, label: strings.nav.pages, Icon: FileText },
        { href: `${pBase}/keywords`, label: strings.nav.keywords, Icon: Search },
        { href: `${pBase}/competitors`, label: strings.nav.competitors, Icon: Users },
        { href: `${pBase}/content`, label: strings.nav.content, Icon: Sparkles },
        { href: `${pBase}/ai-search`, label: strings.nav.aiSearch, Icon: Globe },
        { href: `${pBase}/actions`, label: strings.nav.actions, Icon: CheckSquare },
        { href: `${pBase}/reports`, label: strings.nav.reports, Icon: FileSpreadsheet },
        { href: `${pBase}/settings`, label: strings.nav.projectSettings, Icon: Settings },
      ]
    : [];

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg)] text-[var(--fg)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 focus:rounded-[8px] focus:bg-[var(--brand)] focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        {strings.skipToContent}
      </a>

      {/* Topbar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-elevated)]/95 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href={pBase ? `${pBase}/dashboard` : "/onboarding"} className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[var(--brand)] text-xs font-bold text-white">
              R
            </span>
            <span className="hidden sm:inline text-sm tracking-tight">RankPilot</span>
          </Link>

          {/* Project switcher */}
          <label className="sr-only" htmlFor="project-switcher">
            {strings.topbar.selectProject}
          </label>
          <select
            id="project-switcher"
            aria-label={strings.topbar.selectProject}
            value={currentProjectId ?? "__new__"}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "__new__") {
                router.push("/onboarding");
              } else {
                router.push(`/p/${val}/dashboard`);
              }
            }}
            className="h-8 max-w-[200px] rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--fg)]"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.host})
              </option>
            ))}
            <option value="__new__">{strings.topbar.newProject}</option>
          </select>
        </div>

        {/* Center search / Cmd+K trigger */}
        <button
          type="button"
          onClick={() => setCmdOpen(true)}
          className="hidden md:flex h-8 w-72 items-center justify-between rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--fg-subtle)] hover:border-[var(--border-strong)]"
        >
          <span className="flex items-center gap-2 truncate">
            <Search className="h-3.5 w-3.5" />
            <span className="truncate">{strings.topbar.searchPlaceholder}</span>
          </span>
          <kbd className="rounded border border-[var(--border-strong)] px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>

        {/* Right actions */}
        <div className="flex items-center gap-1.5">
          {/* Locale Switcher (EN / বাংলা) */}
          <button
            type="button"
            onClick={() => router.replace(pathname, { locale: locale === "en" ? "bn" : "en" })}
            aria-label={strings.topbar.language}
            data-testid="locale-switch"
            className="h-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--fg)] hover:bg-[var(--surface-muted)]"
          >
            {locale === "en" ? "বাংলা" : "EN"}
          </button>

          {/* Theme toggle */}
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label={
              resolvedTheme === "dark" ? strings.topbar.themeLight : strings.topbar.themeDark
            }
            data-testid="theme-toggle"
            className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          {/* Agent drawer toggle */}
          <Button
            size="sm"
            variant={agentOpen ? "primary" : "secondary"}
            onClick={() => setAgentOpen((v) => !v)}
            aria-label={strings.topbar.openAgentDrawer}
            data-testid="agent-drawer-toggle"
          >
            <Bot className="h-4 w-4" />
            <span className="hidden sm:inline">{strings.nav.askAgent}</span>
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop collapsible sidebar */}
        <aside
          aria-label="Primary Sidebar"
          className={cn(
            "hidden lg:flex flex-col justify-between border-e border-[var(--border)] bg-[var(--surface)] transition-all",
            sidebarCollapsed ? "w-16" : "w-60",
          )}
        >
          <nav className="space-y-1 p-2">
            {navItems.map(({ href, label, Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  title={sidebarCollapsed ? label : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[8px] px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-[var(--brand-subtle)] text-[var(--brand)]"
                      : "text-[var(--fg-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--fg)]",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && <span className="truncate">{label}</span>}
                </Link>
              );
            })}

            <div className="my-2 border-t border-[var(--border)] pt-2">
              <Link
                href="/onboarding"
                className={cn(
                  "flex items-center gap-2.5 rounded-[8px] px-3 py-2 text-sm font-medium text-[var(--fg-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--fg)]",
                  pathname === "/onboarding" && "bg-[var(--brand-subtle)] text-[var(--brand)]",
                )}
              >
                <PlusCircle className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{strings.nav.onboarding}</span>}
              </Link>
              <Link
                href="/settings"
                className={cn(
                  "flex items-center gap-2.5 rounded-[8px] px-3 py-2 text-sm font-medium text-[var(--fg-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--fg)]",
                  pathname === "/settings" && "bg-[var(--brand-subtle)] text-[var(--brand)]",
                )}
              >
                <KeyRound className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && (
                  <span className="truncate">{strings.nav.accountSettings}</span>
                )}
              </Link>
            </div>
          </nav>

          <div className="border-t border-[var(--border)] p-2 space-y-1">
            {!sidebarCollapsed && (
              <div className="px-3 py-1.5 text-xs text-[var(--fg-subtle)] truncate">
                {user.email ?? user.name}
              </div>
            )}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: `/${locale}/sign-in` })}
                className="flex items-center gap-2 rounded-[8px] px-3 py-1.5 text-xs text-[var(--fg-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--fg)]"
                title={strings.nav.signOut}
              >
                <LogOut className="h-3.5 w-3.5" />
                {!sidebarCollapsed && <span>{strings.nav.signOut}</span>}
              </button>
              <button
                type="button"
                onClick={() => setSidebarCollapsed((c) => !c)}
                aria-label={
                  sidebarCollapsed ? strings.nav.expandSidebar : strings.nav.collapseSidebar
                }
                className="rounded-[8px] p-1.5 text-[var(--fg-muted)] hover:bg-[var(--surface-muted)]"
              >
                {sidebarCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </aside>

        {/* Main content area */}
        <main id="main-content" className="flex-1 overflow-y-auto p-4 pb-20 sm:p-6 lg:pb-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>

        {/* Right-side Agent Drawer */}
        <AgentDrawer
          open={agentOpen}
          onClose={() => setAgentOpen(false)}
          activeProjectId={currentProjectId}
          budgetRunUsd={budgetRunUsd}
          profileVersion={profileVersion}
          strings={strings.agentDrawer}
        />
      </div>

      {/* Mobile bottom tab bar (<1024px) */}
      <nav
        aria-label="Mobile Navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around border-t border-[var(--border)] bg-[var(--surface-elevated)] px-2 lg:hidden"
      >
        {pBase && (
          <>
            <Link
              href={`${pBase}/dashboard`}
              className="flex flex-col items-center gap-0.5 text-[11px] font-medium text-[var(--fg-muted)]"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>{strings.nav.dashboard}</span>
            </Link>
            <Link
              href={`${pBase}/audit`}
              className="flex flex-col items-center gap-0.5 text-[11px] font-medium text-[var(--fg-muted)]"
            >
              <Activity className="h-4 w-4" />
              <span>{strings.nav.audit}</span>
            </Link>
            <Link
              href={`${pBase}/actions`}
              className="flex flex-col items-center gap-0.5 text-[11px] font-medium text-[var(--fg-muted)]"
            >
              <CheckSquare className="h-4 w-4" />
              <span>{strings.nav.actions}</span>
            </Link>
          </>
        )}
        <button
          type="button"
          onClick={() => setAgentOpen(true)}
          className="flex flex-col items-center gap-0.5 text-[11px] font-medium text-[var(--brand)]"
        >
          <Bot className="h-4 w-4" />
          <span>{strings.nav.askAgent}</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="flex flex-col items-center gap-0.5 text-[11px] font-medium text-[var(--fg-muted)]"
        >
          <Menu className="h-4 w-4" />
          <span>{strings.nav.more}</span>
        </button>
      </nav>

      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-14 rounded-t-[16px] border-t border-[var(--border)] bg-[var(--surface-elevated)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-2 gap-2">
              {navItems.map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-2 rounded-[8px] border border-[var(--border)] p-2.5 text-xs font-medium"
                >
                  <Icon className="h-4 w-4 text-[var(--brand)]" />
                  <span className="truncate">{label}</span>
                </Link>
              ))}
              <Link
                href="/settings"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2 rounded-[8px] border border-[var(--border)] p-2.5 text-xs font-medium"
              >
                <KeyRound className="h-4 w-4 text-[var(--brand)]" />
                <span className="truncate">{strings.nav.accountSettings}</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        activeProjectId={currentProjectId}
        onOpenAgent={() => setAgentOpen(true)}
        strings={strings.nav}
      />
    </div>
  );
}

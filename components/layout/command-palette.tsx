"use client";

import * as React from "react";
import { Command } from "cmdk";
import {
  Activity,
  Bot,
  CheckSquare,
  FileSpreadsheet,
  FileText,
  Globe,
  KeyRound,
  LayoutDashboard,
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
import { usePathname, useRouter } from "@/lib/i18n/routing";

export interface CommandPaletteStrings {
  placeholder: string;
  dashboard: string;
  audit: string;
  pages: string;
  keywords: string;
  competitors: string;
  content: string;
  aiSearch: string;
  actions: string;
  reports: string;
  projectSettings: string;
  accountSettings: string;
  onboarding: string;
  askAgent: string;
  themeLight: string;
  themeDark: string;
  language: string;
}

export function CommandPalette({
  open,
  onOpenChange,
  activeProjectId,
  onOpenAgent,
  strings,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  activeProjectId: string | null;
  onOpenAgent: () => void;
  strings: CommandPaletteStrings;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const { setTheme } = useTheme();

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      } else if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const pBase = activeProjectId ? `/p/${activeProjectId}` : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface-elevated)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command className="w-full">
          <div className="flex items-center border-b border-[var(--border)] px-3">
            <Search className="me-2 h-4 w-4 text-[var(--fg-subtle)]" />
            <Command.Input
              autoFocus
              placeholder={strings.placeholder}
              className="h-11 w-full bg-transparent text-sm text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2 text-sm">
            <Command.Empty className="py-6 text-center text-xs text-[var(--fg-subtle)]">
              No matching commands.
            </Command.Empty>

            {pBase && (
              <Command.Group
                heading="Project Navigation"
                className="px-2 py-1.5 text-xs font-semibold text-[var(--fg-subtle)]"
              >
                <CommandItem onSelect={() => go(`${pBase}/dashboard`)} icon={LayoutDashboard}>
                  {strings.dashboard}
                </CommandItem>
                <CommandItem onSelect={() => go(`${pBase}/audit`)} icon={Activity}>
                  {strings.audit}
                </CommandItem>
                <CommandItem onSelect={() => go(`${pBase}/pages`)} icon={FileText}>
                  {strings.pages}
                </CommandItem>
                <CommandItem onSelect={() => go(`${pBase}/keywords`)} icon={Search}>
                  {strings.keywords}
                </CommandItem>
                <CommandItem onSelect={() => go(`${pBase}/competitors`)} icon={Users}>
                  {strings.competitors}
                </CommandItem>
                <CommandItem onSelect={() => go(`${pBase}/content`)} icon={Sparkles}>
                  {strings.content}
                </CommandItem>
                <CommandItem onSelect={() => go(`${pBase}/ai-search`)} icon={Globe}>
                  {strings.aiSearch}
                </CommandItem>
                <CommandItem onSelect={() => go(`${pBase}/actions`)} icon={CheckSquare}>
                  {strings.actions}
                </CommandItem>
                <CommandItem onSelect={() => go(`${pBase}/reports`)} icon={FileSpreadsheet}>
                  {strings.reports}
                </CommandItem>
                <CommandItem onSelect={() => go(`${pBase}/settings`)} icon={Settings}>
                  {strings.projectSettings}
                </CommandItem>
              </Command.Group>
            )}

            <Command.Group
              heading="Workspace & Agent"
              className="mt-1 px-2 py-1.5 text-xs font-semibold text-[var(--fg-subtle)]"
            >
              <CommandItem
                onSelect={() => {
                  onOpenChange(false);
                  onOpenAgent();
                }}
                icon={Bot}
              >
                {strings.askAgent}
              </CommandItem>
              <CommandItem onSelect={() => go("/onboarding")} icon={PlusCircle}>
                {strings.onboarding}
              </CommandItem>
              <CommandItem onSelect={() => go("/settings")} icon={KeyRound}>
                {strings.accountSettings}
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  onOpenChange(false);
                  setTheme("light");
                }}
                icon={Sun}
              >
                {strings.themeLight}
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  onOpenChange(false);
                  setTheme("dark");
                }}
                icon={Moon}
              >
                {strings.themeDark}
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  onOpenChange(false);
                  router.replace(pathname, { locale: locale === "en" ? "bn" : "en" });
                }}
                icon={Globe}
              >
                {strings.language}: {locale === "en" ? "বাংলা (BN)" : "English (EN)"}
              </CommandItem>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function CommandItem({
  children,
  onSelect,
  icon: Icon,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-sm text-[var(--fg)] aria-selected:bg-[var(--brand-subtle)] aria-selected:text-[var(--brand)]"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{children}</span>
    </Command.Item>
  );
}

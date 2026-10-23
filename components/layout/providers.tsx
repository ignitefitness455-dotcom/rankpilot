"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { Toaster } from "sonner";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function AppProviders({
  children,
  pwaLabels,
}: {
  children: React.ReactNode;
  pwaLabels: {
    installTitle: string;
    installDesc: string;
    installButton: string;
    dismiss: string;
  };
}) {
  const [deferredPrompt, setDeferredPrompt] = React.useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Ignore service worker registration errors in dev
      });
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      {deferredPrompt && !dismissed && (
        <aside
          aria-label={pwaLabels.installTitle}
          className="fixed bottom-16 md:bottom-4 end-4 z-50 max-w-sm rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface-elevated)] p-4 shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[var(--fg)]">{pwaLabels.installTitle}</p>
              <p className="text-xs text-[var(--fg-muted)]">{pwaLabels.installDesc}</p>
            </div>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label={pwaLabels.dismiss}
              className="text-[var(--fg-subtle)] hover:text-[var(--fg)] p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              onClick={async () => {
                await deferredPrompt.prompt();
                setDeferredPrompt(null);
              }}
            >
              <Download className="h-3.5 w-3.5" />
              {pwaLabels.installButton}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
              {pwaLabels.dismiss}
            </Button>
          </div>
        </aside>
      )}
      <Toaster richColors position="bottom-right" />
    </NextThemesProvider>
  );
}

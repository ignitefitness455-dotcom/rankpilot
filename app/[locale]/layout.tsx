import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Noto_Sans_Bengali } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/lib/i18n/routing";
import { AppProviders } from "@/components/layout/providers";
import "../globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoBengali = Noto_Sans_Bengali({
  subsets: ["bengali"],
  variable: "--font-bengali",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "RankPilot — Autonomous AI SEO Agent",
    template: "%s | RankPilot",
  },
  description:
    "Evidence-first AI SEO Agent powered by Gemini 4 Argon for Google Search and AI Search (GEO).",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "RankPilot",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#5B4FE9" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1020" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function LocaleRootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await getMessages();
  const tPwa = await getTranslations({ locale, namespace: "pwa" });

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${inter.variable} ${notoBengali.variable} ${jetbrainsMono.variable}`}
    >
      <body
        style={{
          fontFamily:
            "var(--font-inter), var(--font-bengali), system-ui, -apple-system, sans-serif",
        }}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AppProviders
            pwaLabels={{
              installTitle: tPwa("installTitle"),
              installDesc: tPwa("installDesc"),
              installButton: tPwa("installButton"),
              dismiss: tPwa("dismiss"),
            }}
          >
            {children}
          </AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

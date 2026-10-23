import { Bot, Shield } from "lucide-react";
import { Link } from "@/lib/i18n/routing";
import { Button, Card } from "@/components/ui/primitives";

export default function BotPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Bot className="h-6 w-6 text-[var(--brand)]" />
          <h1 className="text-2xl font-bold">RankPilotBot/1.0 — Crawler Policy</h1>
        </div>
        <Link href="/">
          <Button variant="outline" size="sm">
            Back
          </Button>
        </Link>
      </div>

      <Card className="space-y-4 text-sm leading-relaxed text-[var(--fg-muted)]">
        <p>
          <strong className="text-[var(--fg)]">RankPilotBot/1.0</strong> is the site-audit crawler
          operated by RankPilot when a website owner initiates a technical SEO audit of their own
          property.
        </p>
        <ul className="list-disc space-y-2 ps-5">
          <li>
            <strong className="text-[var(--fg)]">Strict robots.txt & Crawl-delay compliance:</strong>{" "}
            We parse and respect <code>robots.txt</code> directives for <code>RankPilotBot</code> and{" "}
            <code>*</code> before requesting any page.
          </li>
          <li>
            <strong className="text-[var(--fg)]">Polite rate limits:</strong> Default crawl rate is{" "}
            <code>1 request/second</code> with max concurrency of <code>2</code> per host.
          </li>
          <li>
            <strong className="text-[var(--fg)]">Ownership verification gate:</strong> Unverified
            sites are strictly capped at 50 pages per audit so RankPilot cannot be used as an
            unbounded third-party scanner.
          </li>
          <li>
            <strong className="text-[var(--fg)]">SSRF & private network block:</strong> All private,
            loopback, link-local, CGNAT, and cloud metadata IP ranges are blocked at DNS resolution
            and socket connect time.
          </li>
        </ul>

        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs text-[var(--fg)]">
          <div className="mb-1 flex items-center gap-1.5 text-[var(--fg-subtle)]">
            <Shield className="h-3.5 w-3.5" />
            <span>To block RankPilotBot in robots.txt:</span>
          </div>
          <pre>{`User-agent: RankPilotBot\nDisallow: /`}</pre>
        </div>
      </Card>
    </main>
  );
}

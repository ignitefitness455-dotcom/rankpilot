# RankPilot — Autonomous AI SEO Agent (Gemini 4 Argon)

RankPilot is an evidence-first autonomous AI SEO agent for solo site owners who are not SEO experts. Every finding carries verifiable evidence (URL, measured value, source, timestamp), explains why it matters in plain language, and provides an exact copy-paste fix behind a human approval gate.

---

## Key Highlights

- **Gemini 4 Argon Integration:** Streaming chat drawer with evidence chips, deterministic prefix caching (`<project_profile v=N>`), tool-use allowlists per specialist agent (`auditor`, `researcher`, `writer`, `ops`), and hard spend budget guardrails.
- **Evidence-First Contract:** Zero hallucinated metrics. If a metric cannot be verified via tools or Search Console, it is transparently labeled as unknown or estimate with a confidence score.
- **Human Approval Gate:** All fixes, title edits, schema additions, and patches require explicit human review (`approve`, `edit`, `dismiss`). Every approval is recorded in an immutable, append-only SHA-256 audit log (`approvals`). Dismissing a finding updates `ignored_rules` so the agent never re-suggests it.
- **Bilingual English & Bengali Localization:** Fully localized across all 9 modules in English (`en`) and Bengali (`bn` / বাংলা) via `next-intl` with dedicated Noto Sans Bengali font optimization.
- **Offline PWA Shell:** Installable progressive web application with service worker caching (`/sw.js`), manifest, maskable icons, and offline report view.
- **Zero-Dependency Local Architecture:** Runs out of the box with embedded PostgreSQL (`EMBEDDED_PG=true`) and zero external SaaS dependencies required for local development.

---

## Architecture & Project Structure

```
rankpilot/
├── app/                              # Next.js 16 App Router
│   ├── [locale]/(app)/               # Authenticated App Shell & Module Views
│   │   ├── p/[projectId]/
│   │   │   ├── dashboard/            # Health score, quick wins, crawl timeline
│   │   │   ├── audit/                # Site Audit: issues table, severity filters
│   │   │   ├── pages/                # Crawled pages inventory & safe digests
│   │   │   ├── keywords/             # Topic clustering, intent classification
│   │   │   ├── competitors/          # SERP gap analysis, structure diff
│   │   │   ├── content/              # Content Studio: brief -> draft -> originality
│   │   │   ├── ai-search/            # GEO: bot access, llms.txt, prompt tracker
│   │   │   ├── actions/              # Action Center: Kanban, approval gate, export
│   │   │   ├── reports/              # Bilingual executive reports & PDF print
│   │   │   └── settings/             # Project profile, members, DNS verification
│   │   └── settings/                 # User settings, encrypted BYOK keys, budgets
│   ├── [locale]/(auth)/sign-in/      # Auth.js Google OAuth + Dev Sign-In
│   ├── api/v1/                       # REST API (projects, audit, ai, content, geo...)
│   └── api/health/                   # Healthcheck endpoint (Docker / uptime monitors)
├── components/                       # Shared UI and module-specific client components
│   ├── actions/                      # Kanban board, multi-format export, approvals log
│   ├── agent/                        # Streaming agent chat drawer & tool evidence chips
│   ├── audit/                        # Issue details, PageSpeed insights, crawl UI
│   ├── competitors/                  # Competitor add/list & SERP gap analysis view
│   ├── content/                      # Content Studio brief & draft version editor
│   ├── geo/                          # AI bot access matrix, prompt visibility tracker
│   ├── keywords/                     # Keyword suggest table & cluster tabs
│   ├── layout/                       # AppShell, responsive sidebar, Command Palette (⌘K)
│   └── reports/                      # Bilingual executive report preview & schedule
├── lib/                              # Core domain services (Strict framework boundary)
│   ├── actions/                      # Task priority scoring, approvals, export bundle
│   ├── ai/                           # Gemini 4 Argon wrapper, metering, tools, guards
│   ├── competitors/                  # Competitor crawling & SERP gap analyzer
│   ├── content/                      # Shingle originality (8-gram), brief builder
│   ├── crawler/                      # SSRF-safe fetcher, RFC 9309 robots parser, rules
│   ├── db/                           # Drizzle ORM schema (31 tables), RLS, client
│   ├── geo/                          # AI crawler status, llms.txt generator, readiness
│   ├── keywords/                     # Intent classifier, topic clustering algorithm
│   ├── onpage/                       # On-Page Optimizer: meta variants, entity gaps
│   ├── reports/                      # Print-ready HTML generator, SMTP mailer
│   └── security/                     # AES-256-GCM crypto, SSRF validation, rate limiting
├── worker/                           # Background worker: queued crawls & report schedules
├── drizzle/                          # Drizzle migrations (0000_init.sql) & RLS SQL
├── tests/
│   ├── unit/                         # Unit tests (crypto, env, schema, originality...)
│   ├── integration/                  # Postgres RLS & multi-tenant IDOR matrix tests
│   ├── golden/                       # Golden rule evaluation fixtures
│   └── e2e/                          # Playwright browser end-to-end test suite
└── Dockerfile & Dockerfile.worker    # Production multi-stage container definitions
```

---

## 9 Functional Modules

1. **Dashboard (`/dashboard`):** Unified health score (0–100), crawl status, 28-day Search Console clicks/impressions/CTR/position, top priority fixes, and Quick Wins (positions 4–20).
2. **Site Audit (`/audit`):** 45+ deterministic technical, on-page, performance, and AI-search audit rules with category/severity filters, exact evidence, and copy-paste fixes.
3. **Pages Inventory (`/pages`):** Crawled page URL index, depth, inlinks/outlinks, status codes, Core Web Vitals, and untrusted-data XML digests.
4. **Keyword Research (`/keywords`):** Intent classification (`informational`, `commercial`, `transactional`, `navigational`), automatic topic clustering, priority scoring, and Search Console query extraction.
5. **Competitor & SERP Analysis (`/competitors`):** Competitor tracking, side-by-side heading/schema comparison, and "what top competitors have that you don't" content gap analysis.
6. **Content Studio (`/content`):** Evidence-backed Content Briefs, E-E-A-T article draft generation with human-experience placeholders, and 8-gram shingle originality verification.
7. **AI Search & GEO (`/ai-search`):** AI crawler access matrix (`GPTBot`, `OAI-SearchBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`), copy-pasteable `/llms.txt` generator, per-page citation readiness score, and multi-engine conversational prompt tracking.
8. **Action Center (`/actions`):** Kanban board (`todo`, `in_progress`, `done`), audit issue sync, human approval gate with SHA-256 payload logging, ignored rules persistence, and multi-format exports (`.md`, `.json`, `.csv`, `.patch`).
9. **Executive Reports & Schedules (`/reports`):** Print-ready executive reports in English or Bengali, PDF printing support via `@media print`, automated recurring schedule (weekly/monthly), and SMTP email delivery.

---

## Quick Start (Local Development)

### 1. Prerequisites
- Portable Node.js 22 LTS (installed at `.tools/node` on this machine) or system Node.js $\ge 22.12$.
- No Docker needed by default: RankPilot uses an embedded PostgreSQL instance storing data in `.data/postgres`.

### 2. Setup & Seed
```powershell
$root = "C:\Users\Mohammad Tanveer\.gemini\antigravity\scratch\rankpilot"
$env:PATH = "$root\.tools\node;$env:PATH"
Set-Location $root

# Initialize .env, generate PWA icons, start embedded Postgres & apply migrations + RLS
npm run setup

# Seed comprehensive demo project ("Acme Cloud Docs") across all 9 modules
npm run seed
```

### 3. Run Development Server
```powershell
npm run dev
# Web application available at http://localhost:3000
```

### 4. Run Background Worker (Optional in Dev)
```powershell
npm run worker
# Polls queued crawls and automated report schedules
```

---

## Verification & Test Suites

```powershell
# Typecheck + Lint + All Unit & Integration Tests (14 suites / 53 tests)
npm run check

# Playwright End-to-End Suite
npm run test:e2e
```

---

## Production Deployment Guide

### Option A: Docker Compose (Self-Hosted / VPS)

```bash
# 1. Start external Postgres and Mailpit (for local email catch)
docker compose up -d

# 2. Build and run Next.js standalone container
docker build -t rankpilot-web .
docker run -d --name rankpilot-web -p 3000:3000 --env-file .env.production rankpilot-web

# 3. Build and run background worker
docker build -f Dockerfile.worker -t rankpilot-worker .
docker run -d --name rankpilot-worker --env-file .env.production rankpilot-worker
```

### Option B: Cloud Deployment (Vercel + Neon + Railway/Fly.io)

1. **Database (Neon PostgreSQL):** Provision a serverless PostgreSQL database on [Neon](https://neon.tech). Run `npm run db:migrate` against your production connection string.
2. **Web Frontend (Vercel):** Connect the GitHub repository to Vercel. Set `EMBEDDED_PG=false`, `DATABASE_URL`, `DATABASE_AUTHENTICATED_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, and `NEXT_OUTPUT=standalone`.
3. **Background Worker (Railway or Fly.io):** Deploy `Dockerfile.worker` as an always-on background worker with 512MB RAM to process crawls and scheduled report deliveries.

---

## Security Model

- **Postgres Row-Level Security (RLS):** Every user query runs in an isolated `withUserDb(userId)` transaction setting `app.current_user_id = '<userId>'`. Non-members cannot select, insert, update, or delete rows across projects even if raw SQL is executed.
- **Multi-Tenant IDOR Matrix:** Validated by `tests/integration/rls-and-authz.test.ts`. Non-members receive `404 Not Found` across all service endpoints and object-ID mutations to prevent tenant enumeration.
- **AES-256-GCM BYOK Secret Encryption:** All API keys (`gemini_key`, `openai_key`, `gsc_token`) are encrypted with unique 96-bit initialization vectors and Associated Authenticated Data (AAD) bound to the user's ID.
- **SSRF Prevention:** Enforces RFC 1918 private IP blocking, loopback blocking, IPv6 ULA/link-local blocking, IPv4-mapped IPv6 evasion blocking, and AWS/GCP/Azure/Alibaba cloud metadata IP blocking across all crawler hops.
- **Prompt Injection Defense:** Web text is stripped of boundary break tags, scanned for injection signatures (`ignore previous instructions`, `system prompt override`), and wrapped in `<untrusted_page_content sha256="...">` XML tags before model ingestion.

---

## Unimplemented / Deferred to v2 (Principle #7: No Fake Completeness)

Per **Principle #7 (No Fake Completeness)**, the following features are deliberately not included in v1.0 and are roadmapped for subsequent versions:

1. **Direct CMS Auto-Publishing:** Writing articles directly into production CMSs (WordPress REST API, Webflow API, or GitHub pull requests) is deferred to v2. In v1, approved articles and patches are cleanly exported as Markdown, JSON, CSV, or Git Patches for human review.
2. **Multi-Region Distributed Crawling:** Crawling is executed from a single worker node. Multi-region IP proxy rotation for geolocated SERPs is deferred to v2.
3. **Third-Party Paid Keyword Volume API Subscriptions:** Search volumes from paid commercial APIs (DataForSEO, SerpAPI) are supported via BYOK interface in `lib/keywords/service.ts`, but no proprietary data is fabricated when keys are omitted. Search Console impressions are used as an honest, free proxy.
4. **Automated Payment & Stripe Subscription Metering:** RankPilot v1 is self-hosted and BYOK-oriented. Multi-tier SaaS billing via Stripe is reserved for the hosted cloud offering.

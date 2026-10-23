-- ============================================================================
-- RankPilot 0000_init.sql — Complete schema (31 tables + indexes + constraints)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id text PRIMARY KEY,
  name text,
  email text UNIQUE,
  email_verified timestamptz,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accounts (
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  refresh_token text,
  access_token text,
  expires_at integer,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  PRIMARY KEY (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS public.sessions (
  session_token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.verification_tokens (
  identifier text NOT NULL,
  token text NOT NULL,
  expires timestamptz NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  locale text NOT NULL DEFAULT 'en',
  theme text NOT NULL DEFAULT 'system',
  budget_run_usd numeric(10,4) NOT NULL DEFAULT 0.5,
  budget_project_day_usd numeric(10,4) NOT NULL DEFAULT 2.0,
  budget_user_month_usd numeric(10,4) NOT NULL DEFAULT 20.0,
  use_fast_model boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  host text NOT NULL,
  verified_at timestamptz,
  verify_method text,
  verify_token text NOT NULL,
  cms text,
  language text,
  settings jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_owner_host_uq
  ON public.projects (owner_id, host)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS projects_owner_idx ON public.projects (owner_id);

CREATE TABLE IF NOT EXISTS public.project_members (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS pm_user_idx ON public.project_members (user_id);

CREATE TABLE IF NOT EXISTS public.project_profiles (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  fields jsonb NOT NULL,
  profile_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  tag text NOT NULL,
  key_version integer NOT NULL,
  last4 text,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS integrations_owner_kind_uq
  ON public.integrations (owner_id, kind)
  WHERE project_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS integrations_owner_project_kind_uq
  ON public.integrations (owner_id, project_id, kind)
  WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.crawls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  trigger text NOT NULL,
  config jsonb NOT NULL,
  pages_found integer NOT NULL DEFAULT 0,
  pages_crawled integer NOT NULL DEFAULT 0,
  progress real NOT NULL DEFAULT 0,
  health_score integer,
  score_breakdown jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crawls_project_created_idx ON public.crawls (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  crawl_id uuid NOT NULL REFERENCES public.crawls(id) ON DELETE CASCADE,
  url text NOT NULL,
  url_hash text NOT NULL,
  final_url text,
  status_code integer,
  redirect_chain jsonb,
  content_type text,
  title text,
  meta_description text,
  canonical text,
  robots_meta text,
  x_robots text,
  hreflang jsonb,
  h1 text[],
  headings jsonb,
  word_count integer,
  text_hash text,
  depth integer,
  inlinks integer NOT NULL DEFAULT 0,
  outlinks integer NOT NULL DEFAULT 0,
  schema_types text[],
  schema_raw jsonb,
  has_viewport boolean,
  lang text,
  bytes integer,
  ttfb_ms integer,
  rendered boolean NOT NULL DEFAULT false,
  injection_flag boolean NOT NULL DEFAULT false,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pages_crawl_url_uq ON public.pages (crawl_id, url_hash);
CREATE INDEX IF NOT EXISTS pages_crawl_status_idx ON public.pages (crawl_id, status_code);
CREATE INDEX IF NOT EXISTS pages_project_idx ON public.pages (project_id);

CREATE TABLE IF NOT EXISTS public.links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  crawl_id uuid NOT NULL REFERENCES public.crawls(id) ON DELETE CASCADE,
  from_page_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  to_url text NOT NULL,
  to_page_id uuid REFERENCES public.pages(id) ON DELETE SET NULL,
  anchor text,
  rel text,
  is_internal boolean NOT NULL,
  status_code integer
);
CREATE INDEX IF NOT EXISTS links_crawl_to_idx ON public.links (crawl_id, to_page_id);
CREATE INDEX IF NOT EXISTS links_crawl_from_idx ON public.links (crawl_id, from_page_id);

CREATE TABLE IF NOT EXISTS public.issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  rule_id text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  first_seen_crawl_id uuid REFERENCES public.crawls(id) ON DELETE SET NULL,
  last_seen_crawl_id uuid REFERENCES public.crawls(id) ON DELETE SET NULL,
  fixed_crawl_id uuid REFERENCES public.crawls(id) ON DELETE SET NULL,
  affected_count integer NOT NULL DEFAULT 0,
  finding jsonb NOT NULL,
  ignored_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS issues_project_rule_uq ON public.issues (project_id, rule_id);
CREATE INDEX IF NOT EXISTS issues_project_status_idx ON public.issues (project_id, status, severity);

CREATE TABLE IF NOT EXISTS public.issue_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
  crawl_id uuid NOT NULL REFERENCES public.crawls(id) ON DELETE CASCADE,
  page_id uuid REFERENCES public.pages(id) ON DELETE CASCADE,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS issue_instances_issue_crawl_idx ON public.issue_instances (issue_id, crawl_id);

CREATE TABLE IF NOT EXISTS public.cwv_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  url text NOT NULL,
  strategy text NOT NULL,
  source text NOT NULL,
  lcp_ms real,
  inp_ms real,
  cls real,
  fcp_ms real,
  ttfb_ms real,
  perf_score real,
  raw jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cwv_project_url_idx ON public.cwv_results (project_id, url, fetched_at DESC);

CREATE TABLE IF NOT EXISTS public.search_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  date date NOT NULL,
  page text NOT NULL,
  query text NOT NULL,
  country text NOT NULL DEFAULT '',
  device text NOT NULL DEFAULT '',
  clicks integer NOT NULL,
  impressions integer NOT NULL,
  ctr real NOT NULL,
  position real NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sp_row_uq
  ON public.search_performance (project_id, date, page, query, country, device);
CREATE INDEX IF NOT EXISTS sp_project_date_idx ON public.search_performance (project_id, date);
CREATE INDEX IF NOT EXISTS sp_project_query_idx ON public.search_performance (project_id, query);

CREATE TABLE IF NOT EXISTS public.analytics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  date date NOT NULL,
  page_path text NOT NULL,
  source_medium text NOT NULL DEFAULT '',
  sessions integer NOT NULL DEFAULT 0,
  engaged_sessions integer NOT NULL DEFAULT 0,
  conversions real NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_row_uq
  ON public.analytics_daily (project_id, date, page_path, source_medium);
CREATE INDEX IF NOT EXISTS ad_project_date_idx ON public.analytics_daily (project_id, date);

CREATE TABLE IF NOT EXISTS public.keyword_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  intent text,
  pillar_keyword text,
  priority integer NOT NULL DEFAULT 0,
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cluster_id uuid REFERENCES public.keyword_clusters(id) ON DELETE SET NULL,
  keyword text NOT NULL,
  normalized text NOT NULL,
  intent text,
  intent_confidence real,
  volume integer,
  volume_source text,
  difficulty_est real,
  difficulty_confidence real,
  gsc_impressions_28d integer,
  gsc_position real,
  priority integer NOT NULL DEFAULT 0,
  sources text[] NOT NULL DEFAULT '{}'::text[],
  tracked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS keywords_project_norm_uq ON public.keywords (project_id, normalized);
CREATE INDEX IF NOT EXISTS keywords_project_tracked_idx ON public.keywords (project_id, tracked);

CREATE TABLE IF NOT EXISTS public.rank_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  keyword_id uuid NOT NULL REFERENCES public.keywords(id) ON DELETE CASCADE,
  date date NOT NULL,
  position real,
  url text,
  source text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS rank_history_uq ON public.rank_history (keyword_id, date, source);

CREATE TABLE IF NOT EXISTS public.competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  host text NOT NULL,
  name text,
  notes text,
  auto_discovered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS competitors_project_host_uq
  ON public.competitors (project_id, host)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.tracked_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  locale text NOT NULL DEFAULT 'en',
  engines text[] NOT NULL DEFAULT '{gemini}'::text[],
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.ai_visibility_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tracked_prompt_id uuid NOT NULL REFERENCES public.tracked_prompts(id) ON DELETE CASCADE,
  engine text NOT NULL,
  mentioned boolean NOT NULL,
  cited boolean NOT NULL,
  cited_urls text[] NOT NULL DEFAULT '{}'::text[],
  competitors_mentioned text[] NOT NULL DEFAULT '{}'::text[],
  answer_excerpt text,
  raw jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS avc_prompt_checked_idx
  ON public.ai_visibility_checks (tracked_prompt_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  parent_run_id uuid,
  kind text NOT NULL,
  agent text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  input jsonb,
  output jsonb,
  steps_count integer NOT NULL DEFAULT 0,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  tokens_thinking integer NOT NULL DEFAULT 0,
  tokens_cached integer NOT NULL DEFAULT 0,
  cost_usd real NOT NULL DEFAULT 0,
  budget_usd real NOT NULL,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_project_created_idx ON public.runs (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  type text NOT NULL,
  summary text NOT NULL,
  tool_name text,
  args jsonb,
  result jsonb,
  tokens integer NOT NULL DEFAULT 0,
  cost_usd real NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS run_steps_run_idx_uq ON public.run_steps (run_id, idx);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  evidence jsonb,
  actions jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_run_idx ON public.chat_messages (run_id, created_at);

CREATE TABLE IF NOT EXISTS public.content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  target_keyword text,
  status text NOT NULL DEFAULT 'draft',
  brief jsonb,
  current_version_id uuid,
  seo_score integer,
  checklist jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  content_item_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  version integer NOT NULL,
  body_md text NOT NULL,
  author text NOT NULL,
  run_id uuid REFERENCES public.runs(id) ON DELETE SET NULL,
  originality jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS content_versions_item_version_uq
  ON public.content_versions (content_item_id, version);

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL,
  source text NOT NULL,
  title text NOT NULL,
  description text,
  impact integer NOT NULL,
  effort integer NOT NULL,
  confidence real NOT NULL,
  priority integer NOT NULL,
  status text NOT NULL DEFAULT 'todo',
  position real NOT NULL DEFAULT 0,
  assignee_id text REFERENCES public.users(id) ON DELETE SET NULL,
  fix jsonb,
  approved_by text REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_project_status_priority_idx
  ON public.tasks (project_id, status, priority DESC);

CREATE TABLE IF NOT EXISTS public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  payload_hash text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approvals_project_idx ON public.approvals (project_id, at);

CREATE TABLE IF NOT EXISTS public.ignored_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  rule_id text,
  pattern jsonb,
  reason text,
  user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  period text NOT NULL,
  range_start date NOT NULL,
  range_end date NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  locale text NOT NULL DEFAULT 'en',
  data jsonb,
  html text,
  pdf_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_project_created_idx ON public.reports (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cadence text NOT NULL,
  day integer NOT NULL,
  hour integer NOT NULL,
  tz text NOT NULL,
  recipients text[] NOT NULL DEFAULT '{}'::text[],
  locale text NOT NULL DEFAULT 'en',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alerts_project_created_idx ON public.alerts (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.usage_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  day date NOT NULL,
  model text NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  tokens_thinking integer NOT NULL DEFAULT 0,
  tokens_cached integer NOT NULL DEFAULT 0,
  grounding_requests integer NOT NULL DEFAULT 0,
  cost_usd real NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS usage_metrics_uq
  ON public.usage_metrics (user_id, project_id, day, model)
  NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS usage_metrics_user_day_idx ON public.usage_metrics (user_id, day);

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text PRIMARY KEY,
  tokens real NOT NULL,
  refilled_at timestamptz NOT NULL DEFAULT now()
);

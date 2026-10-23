-- ============================================================================
-- RankPilot Row-Level Security (RLS) & Runtime Role Setup
-- Applied idempotently by `scripts/setup.ts` using the owner/admin connection.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rankpilot_app') THEN
    CREATE ROLE rankpilot_app LOGIN PASSWORD 'rankpilot_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE rankpilot_app WITH LOGIN PASSWORD 'rankpilot_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO rankpilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rankpilot_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rankpilot_app;

-- Current authenticated user id set via `set_config('app.user_id', ..., true)` per transaction.
CREATE OR REPLACE FUNCTION public.app_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.user_id', true), '');
$$;

-- Role weight helper: viewer=1, editor=2, owner=3
CREATE OR REPLACE FUNCTION public.app_role_weight(r text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE r
    WHEN 'owner' THEN 3
    WHEN 'editor' THEN 2
    WHEN 'viewer' THEN 1
    ELSE 0
  END;
$$;

-- SECURITY DEFINER helper avoids RLS recursion between projects and project_members.
CREATE OR REPLACE FUNCTION public.app_has_project_access(p_id uuid, min_role text DEFAULT 'viewer')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.app_user_id() IS NULL OR p_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.projects p
      LEFT JOIN public.project_members pm
        ON pm.project_id = p.id AND pm.user_id = public.app_user_id()
      WHERE p.id = p_id
        AND p.deleted_at IS NULL
        AND (
          (p.owner_id = public.app_user_id() AND 3 >= public.app_role_weight(min_role))
          OR (pm.role IS NOT NULL AND public.app_role_weight(pm.role) >= public.app_role_weight(min_role))
        )
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.app_user_id() TO rankpilot_app;
GRANT EXECUTE ON FUNCTION public.app_role_weight(text) TO rankpilot_app;
GRANT EXECUTE ON FUNCTION public.app_has_project_access(uuid, text) TO rankpilot_app;

-- 1. User-scoped tables
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_settings_self ON public.user_settings;
CREATE POLICY user_settings_self ON public.user_settings
  FOR ALL TO rankpilot_app
  USING (user_id = public.app_user_id())
  WITH CHECK (user_id = public.app_user_id());

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS integrations_owner ON public.integrations;
CREATE POLICY integrations_owner ON public.integrations
  FOR ALL TO rankpilot_app
  USING (owner_id = public.app_user_id())
  WITH CHECK (owner_id = public.app_user_id());

ALTER TABLE public.usage_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usage_metrics_owner ON public.usage_metrics;
CREATE POLICY usage_metrics_owner ON public.usage_metrics
  FOR ALL TO rankpilot_app
  USING (user_id = public.app_user_id())
  WITH CHECK (user_id = public.app_user_id());

-- 2. Projects & members
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_select ON public.projects;
DROP POLICY IF EXISTS projects_insert ON public.projects;
DROP POLICY IF EXISTS projects_update ON public.projects;
DROP POLICY IF EXISTS projects_delete ON public.projects;

CREATE POLICY projects_select ON public.projects
  FOR SELECT TO rankpilot_app
  USING (
    deleted_at IS NULL
    AND (owner_id = public.app_user_id() OR public.app_has_project_access(id, 'viewer'))
  );

CREATE POLICY projects_insert ON public.projects
  FOR INSERT TO rankpilot_app
  WITH CHECK (owner_id = public.app_user_id());

CREATE POLICY projects_update ON public.projects
  FOR UPDATE TO rankpilot_app
  USING (owner_id = public.app_user_id() OR public.app_has_project_access(id, 'editor'))
  WITH CHECK (owner_id = public.app_user_id() OR public.app_has_project_access(id, 'editor'));

CREATE POLICY projects_delete ON public.projects
  FOR DELETE TO rankpilot_app
  USING (owner_id = public.app_user_id());

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_members_select ON public.project_members;
DROP POLICY IF EXISTS project_members_write ON public.project_members;

CREATE POLICY project_members_select ON public.project_members
  FOR SELECT TO rankpilot_app
  USING (user_id = public.app_user_id() OR public.app_has_project_access(project_id, 'viewer'));

CREATE POLICY project_members_write ON public.project_members
  FOR ALL TO rankpilot_app
  USING (public.app_has_project_access(project_id, 'owner'))
  WITH CHECK (public.app_has_project_access(project_id, 'owner'));

-- 3. All project_id-scoped child tables
DO $$
DECLARE
  tbl text;
  project_tables text[] := ARRAY[
    'project_profiles',
    'crawls',
    'pages',
    'links',
    'issues',
    'issue_instances',
    'cwv_results',
    'search_performance',
    'analytics_daily',
    'keyword_clusters',
    'keywords',
    'rank_history',
    'competitors',
    'tracked_prompts',
    'ai_visibility_checks',
    'runs',
    'run_steps',
    'chat_messages',
    'content_items',
    'content_versions',
    'tasks',
    'approvals',
    'ignored_rules',
    'reports',
    'report_schedules',
    'alerts'
  ];
BEGIN
  FOREACH tbl IN ARRAY project_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_rls_select ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_rls_write ON public.%I', tbl, tbl);

    EXECUTE format(
      'CREATE POLICY %I_rls_select ON public.%I FOR SELECT TO rankpilot_app USING (public.app_has_project_access(project_id, ''viewer''))',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_rls_write ON public.%I FOR ALL TO rankpilot_app USING (public.app_has_project_access(project_id, ''editor'')) WITH CHECK (public.app_has_project_access(project_id, ''editor''))',
      tbl, tbl
    );
  END LOOP;
END
$$;

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, deletedAt, pk, ts, updatedAt } from "./_shared";
import { users } from "./auth";

export type ProjectRole = "owner" | "editor" | "viewer";
export type VerifyMethod = "dns_txt" | "meta_tag" | "gsc";

export interface ProjectSettings {
  crawl: { maxPages: number; maxDepth: number; render: boolean; rps: number };
  /** Optional per-project override of the user's project/day AI budget. */
  budgetProjectDayUsd?: number;
}

export const projects = pgTable(
  "projects",
  {
    id: pk(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    host: text("host").notNull(),
    verifiedAt: ts("verified_at"),
    verifyMethod: text("verify_method").$type<VerifyMethod>(),
    verifyToken: text("verify_token").notNull(),
    cms: text("cms"),
    language: text("language"),
    settings: jsonb("settings").$type<ProjectSettings>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("projects_owner_host_uq").on(t.ownerId, t.host).where(sql`${t.deletedAt} is null`),
    index("projects_owner_idx").on(t.ownerId),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<ProjectRole>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("pm_user_idx").on(t.userId)],
);

export interface ProfileFields {
  brandVoice: string;
  audience: string;
  goals: string;
  constraints: string;
  siteType: string;
  niche: string;
  countries: string[];
  languages: string[];
  competitorHosts: string[];
}

export const projectProfiles = pgTable("project_profiles", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  fields: jsonb("fields").$type<ProfileFields>().notNull(),
  /** Deterministic serialization used as part of the cached prompt prefix. */
  profileText: text("profile_text").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type IntegrationKind =
  | "google_oauth"
  | "gemini_key"
  | "serpapi"
  | "serper"
  | "dataforseo"
  | "openai"
  | "perplexity"
  | "smtp";

/** Encrypted secrets (AES-256-GCM). Never returned to the client. RLS: owner_id = app_user(). */
export const integrations = pgTable(
  "integrations",
  {
    id: pk(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<IntegrationKind>().notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    keyVersion: integer("key_version").notNull(),
    last4: text("last4"),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    lastOkAt: ts("last_ok_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("integrations_owner_kind_uq")
      .on(t.ownerId, t.kind)
      .where(sql`${t.projectId} is null`),
    uniqueIndex("integrations_owner_project_kind_uq")
      .on(t.ownerId, t.projectId, t.kind)
      .where(sql`${t.projectId} is not null`),
  ],
);

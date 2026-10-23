"use client";

import * as React from "react";
import { Copy, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "@/lib/i18n/routing";
import { Badge, Button, Card, Input, Select, Textarea } from "@/components/ui/primitives";
import type { ProfileFields, ProjectRole } from "@/lib/db/schema";

export interface ProjectSettingsClientProps {
  projectId: string;
  host: string;
  verifyToken: string;
  initialVersion: number;
  initialFields: ProfileFields;
  initialProfileText: string;
  initialMembers: Array<{
    userId: string;
    email: string | null;
    name: string | null;
    role: ProjectRole;
  }>;
  strings: {
    title: string;
    subtitle: string;
    verificationTitle: string;
    verificationDesc: string;
    dnsRecordLabel: string;
    metaTagLabel: string;
    profileEditorTitle: string;
    saveProfileButton: string;
    prefixPreviewTitle: string;
    membersTitle: string;
    inviteEmailPlaceholder: string;
    inviteButton: string;
    dangerZoneTitle: string;
    deleteProjectButton: string;
  };
}

export function ProjectSettingsClient({
  projectId,
  host,
  verifyToken,
  initialVersion,
  initialFields,
  initialProfileText,
  initialMembers,
  strings,
}: ProjectSettingsClientProps) {
  const router = useRouter();
  const [version, setVersion] = React.useState(initialVersion);
  const [fields, setFields] = React.useState<ProfileFields>(initialFields);
  const [profileText, setProfileText] = React.useState(initialProfileText);
  const [saving, setSaving] = React.useState(false);

  const [members, setMembers] = React.useState(initialMembers);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<"editor" | "viewer">("viewer");
  const [verifyingMethod, setVerifyingMethod] = React.useState<string | null>(null);
  const [verifyFeedback, setVerifyFeedback] = React.useState<{
    verified: boolean;
    message: string;
  } | null>(null);

  const dnsTxtValue = `rankpilot-verify=${verifyToken}`;
  const metaTagValue = `<meta name="rankpilot-verify" content="${verifyToken}" />`;

  const handleVerifyOwnership = async (method: "dns_txt" | "meta_tag") => {
    setVerifyingMethod(method);
    setVerifyFeedback(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error?.message || "Verification request failed");
      }
      if (json.data.verified) {
        setVerifyFeedback({
          verified: true,
          message: `Verified via ${method === "dns_txt" ? "DNS TXT" : "HTML Meta Tag"} at ${json.data.verifiedAt}`,
        });
        toast.success("Domain ownership verified! Crawl cap unlocked.");
        router.refresh();
      } else {
        setVerifyFeedback({
          verified: false,
          message: json.data.reason || "Token not detected yet.",
        });
        toast.error(json.data.reason || "Ownership verification token not found yet.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification check failed");
    } finally {
      setVerifyingMethod(null);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error?.message || "Failed to update profile");
      }
      setVersion(json.data.version);
      setProfileText(json.data.profileText);
      toast.success(`Saved profile (v${json.data.version})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error?.message || "Could not add member");
      }
      const listRes = await fetch(`/api/v1/projects/${projectId}/members`);
      const listJson = await listRes.json();
      if (listJson.ok) setMembers(listJson.data);
      setInviteEmail("");
      toast.success("Member added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add member");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)]">{strings.title}</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">{strings.subtitle}</p>
      </div>

      {/* Ownership Verification Token */}
      <Card className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--fg)]">{strings.verificationTitle}</h2>
          <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{strings.verificationDesc}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-[var(--fg)]">
              {strings.dnsRecordLabel.replace("{host}", host)}
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={dnsTxtValue} className="font-mono text-xs" />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(dnsTxtValue);
                  toast.success("Copied DNS TXT value");
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-[var(--fg)]">{strings.metaTagLabel}</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={metaTagValue} className="font-mono text-xs" />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(metaTagValue);
                  toast.success("Copied HTML meta tag");
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={verifyingMethod !== null}
            onClick={() => handleVerifyOwnership("dns_txt")}
            data-testid="verify-dns-btn"
          >
            {verifyingMethod === "dns_txt" ? "Checking DNS..." : "Verify DNS TXT Record"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={verifyingMethod !== null}
            onClick={() => handleVerifyOwnership("meta_tag")}
            data-testid="verify-meta-btn"
          >
            {verifyingMethod === "meta_tag" ? "Fetching Homepage..." : "Verify HTML Meta Tag"}
          </Button>
          {verifyFeedback && (
            <span
              className={`text-xs font-medium ${
                verifyFeedback.verified ? "text-[var(--good)]" : "text-[var(--warning)]"
              }`}
            >
              {verifyFeedback.message}
            </span>
          )}
        </div>
      </Card>

      {/* Project Profile Editor */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--fg)]">
            {strings.profileEditorTitle}
          </h2>
          <Badge variant="brand">v{version}</Badge>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="pf-niche" className="text-xs font-medium text-[var(--fg)]">
                Niche / Industry
              </label>
              <Input
                id="pf-niche"
                value={fields.niche}
                onChange={(e) => setFields({ ...fields, niche: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pf-competitors" className="text-xs font-medium text-[var(--fg)]">
                Competitors (comma-separated)
              </label>
              <Input
                id="pf-competitors"
                value={fields.competitorHosts.join(", ")}
                onChange={(e) =>
                  setFields({
                    ...fields,
                    competitorHosts: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="pf-voice" className="text-xs font-medium text-[var(--fg)]">
                Brand Voice
              </label>
              <Textarea
                id="pf-voice"
                value={fields.brandVoice}
                onChange={(e) => setFields({ ...fields, brandVoice: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pf-audience" className="text-xs font-medium text-[var(--fg)]">
                Audience
              </label>
              <Textarea
                id="pf-audience"
                value={fields.audience}
                onChange={(e) => setFields({ ...fields, audience: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pf-goals" className="text-xs font-medium text-[var(--fg)]">
                Primary Goals
              </label>
              <Textarea
                id="pf-goals"
                value={fields.goals}
                onChange={(e) => setFields({ ...fields, goals: e.target.value })}
                required
              />
            </div>
          </div>

          <Button type="submit" disabled={saving}>
            {strings.saveProfileButton}
          </Button>
        </form>

        <div className="space-y-1.5 pt-2">
          <p className="text-xs font-semibold text-[var(--fg-muted)]">
            {strings.prefixPreviewTitle}
          </p>
          <pre className="overflow-x-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs text-[var(--fg)]">
            {profileText}
          </pre>
        </div>
      </Card>

      {/* Team Members */}
      <Card className="space-y-4">
        <h2 className="text-base font-semibold text-[var(--fg)]">{strings.membersTitle}</h2>
        <div className="divide-y divide-[var(--border)]">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-[var(--fg)]">{m.name ?? m.email}</span>
                {m.email && (
                  <span className="ms-2 text-xs text-[var(--fg-muted)]">({m.email})</span>
                )}
              </div>
              <Badge variant={m.role === "owner" ? "brand" : "neutral"}>{m.role}</Badge>
            </div>
          ))}
        </div>

        <form onSubmit={handleInvite} className="flex flex-wrap items-center gap-2 pt-2">
          <Input
            type="email"
            placeholder={strings.inviteEmailPlaceholder}
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="sm:w-64"
          />
          <Select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}
            className="sm:w-36"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </Select>
          <Button type="submit" variant="secondary" size="sm">
            <UserPlus className="h-3.5 w-3.5" />
            {strings.inviteButton}
          </Button>
        </form>
      </Card>

      {/* Danger Zone */}
      <Card className="flex items-center justify-between border-[var(--critical-border)]">
        <span className="text-sm font-semibold text-[var(--critical)]">
          {strings.dangerZoneTitle}
        </span>
        <Button
          variant="danger"
          size="sm"
          onClick={async () => {
            if (!window.confirm("Archive this project?")) return;
            const res = await fetch(`/api/v1/projects/${projectId}`, { method: "DELETE" });
            if (res.ok) {
              router.push("/onboarding");
              router.refresh();
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
          {strings.deleteProjectButton}
        </Button>
      </Card>
    </div>
  );
}

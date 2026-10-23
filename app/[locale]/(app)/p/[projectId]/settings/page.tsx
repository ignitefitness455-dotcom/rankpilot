import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuthUser } from "@/lib/auth";
import { withUserDb } from "@/lib/db/rls";
import { getProjectDetail, listProjectMembers } from "@/lib/projects/service";
import { DEFAULT_PROFILE_FIELDS } from "@/lib/projects/profile";
import { ForbiddenError, NotFoundError } from "@/lib/security/authz";
import { ProjectSettingsClient } from "@/components/projects/project-settings-client";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  const user = await requireAuthUser();

  let detail;
  try {
    detail = await getProjectDetail(user.id, projectId);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) {
      notFound();
    }
    throw err;
  }

  const [members, t] = await Promise.all([
    withUserDb(user.id, (tx) => listProjectMembers(tx, user.id, projectId)),
    getTranslations({ locale, namespace: "projectSettings" }),
  ]);

  return (
    <ProjectSettingsClient
      projectId={detail.project.id}
      host={detail.project.host}
      verifyToken={detail.project.verifyToken}
      initialVersion={detail.profile?.version ?? 1}
      initialFields={detail.profile?.fields ?? DEFAULT_PROFILE_FIELDS}
      initialProfileText={detail.profile?.profileText ?? ""}
      initialMembers={members}
      strings={{
        title: t("title"),
        subtitle: t("subtitle"),
        verificationTitle: t("verificationTitle"),
        verificationDesc: t("verificationDesc"),
        dnsRecordLabel: t("dnsRecordLabel"),
        metaTagLabel: t("metaTagLabel"),
        profileEditorTitle: t("profileEditorTitle"),
        saveProfileButton: t("saveProfileButton"),
        prefixPreviewTitle: t("prefixPreviewTitle"),
        membersTitle: t("membersTitle"),
        inviteEmailPlaceholder: t("inviteEmailPlaceholder"),
        inviteButton: t("inviteButton"),
        dangerZoneTitle: t("dangerZoneTitle"),
        deleteProjectButton: t("deleteProjectButton"),
      }}
    />
  );
}

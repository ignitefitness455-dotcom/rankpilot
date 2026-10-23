import { getTranslations } from "next-intl/server";
import { requireAuthUser } from "@/lib/auth";
import {
  getOrCreateUserSettings,
  getUserUsageSummary,
  listUserIntegrationsMasked,
} from "@/lib/settings/service";
import { SettingsClient } from "@/components/settings/settings-client";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await requireAuthUser();

  const [keys, budgets, usage, t] = await Promise.all([
    listUserIntegrationsMasked(user.id),
    getOrCreateUserSettings(user.id),
    getUserUsageSummary(user.id),
    getTranslations({ locale, namespace: "settings" }),
  ]);

  return (
    <SettingsClient
      initialKeys={keys}
      initialBudgets={budgets}
      usage={usage}
      strings={{
        title: t("title"),
        subtitle: t("subtitle"),
        byokSectionTitle: t("byokSectionTitle"),
        byokSectionDesc: t("byokSectionDesc"),
        statusByok: t("statusByok"),
        statusServerEnv: t("statusServerEnv"),
        statusNone: t("statusNone"),
        saveKey: t("saveKey"),
        removeKey: t("removeKey"),
        keyPlaceholder: t("keyPlaceholder"),
        budgetSectionTitle: t("budgetSectionTitle"),
        budgetSectionDesc: t("budgetSectionDesc"),
        budgetRunLabel: t("budgetRunLabel"),
        budgetProjectDayLabel: t("budgetProjectDayLabel"),
        budgetUserMonthLabel: t("budgetUserMonthLabel"),
        fastModelToggleLabel: t("fastModelToggleLabel"),
        saveBudgetsButton: t("saveBudgetsButton"),
        usageSectionTitle: t("usageSectionTitle"),
        todaySpend: t("todaySpend"),
        monthSpend: t("monthSpend"),
        monthTokens: t("monthTokens"),
        dataPrivacyTitle: t("dataPrivacyTitle"),
        exportButton: t("exportButton"),
        deleteAccountButton: t("deleteAccountButton"),
        savedToast: t("savedToast"),
      }}
    />
  );
}

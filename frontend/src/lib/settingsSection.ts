import { SETTINGS_TABS } from "@/constants";

export const VALID_SETTINGS_SECTIONS = SETTINGS_TABS.map((tab) => tab.id);

export type SettingsSection = (typeof SETTINGS_TABS)[number]["id"];

export function normalizeSettingsSection(raw: unknown): SettingsSection {
  if (
    typeof raw === "string" &&
    VALID_SETTINGS_SECTIONS.includes(raw as SettingsSection)
  ) {
    return raw as SettingsSection;
  }
  return "appearance";
}

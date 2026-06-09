import { describe, it, expect } from "vitest";

import {
  normalizeSettingsSection,
  VALID_SETTINGS_SECTIONS,
} from "./settingsSection";

describe("settingsSection", () => {
  it("accepts valid settings section ids", () => {
    for (const section of VALID_SETTINGS_SECTIONS) {
      expect(normalizeSettingsSection(section)).toBe(section);
    }
  });

  it("defaults unknown sections to appearance", () => {
    expect(normalizeSettingsSection("unknown")).toBe("appearance");
    expect(normalizeSettingsSection(undefined)).toBe("appearance");
    expect(normalizeSettingsSection(null)).toBe("appearance");
  });

  it("normalizes network section for deep links", () => {
    expect(normalizeSettingsSection("network")).toBe("network");
    expect(normalizeSettingsSection("diagnostics")).toBe("diagnostics");
  });
});

import { getRouteApi } from "@tanstack/react-router";

import {
  normalizeSettingsSection,
  type SettingsSection,
} from "@/lib/settingsSection";

const summarizerRoute = getRouteApi("/_tg/summarizer");

export function useSettingsSection() {
  const { section } = summarizerRoute.useSearch();
  const navigate = summarizerRoute.useNavigate();

  const activeSection = normalizeSettingsSection(section);

  const setActiveSection = (next: SettingsSection) => {
    const safe = normalizeSettingsSection(next);
    navigate({
      search: (prev) => ({ ...prev, section: safe }),
      replace: true,
    });
  };

  return { activeSection, setActiveSection };
}

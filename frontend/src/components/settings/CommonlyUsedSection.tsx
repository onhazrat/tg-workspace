import type React from "react"
import { SettingRow } from "@/components/settings/SettingRow"
import type { Theme } from "@/components/theme-provider"
import { useSettings } from "@/contexts/SettingsContext"
import { commonlyUsedEntries } from "@/lib/settings/catalog"
import type { SettingCatalogEntry } from "@/lib/settings/catalog-types"

function useCatalogValue(
  entry: SettingCatalogEntry,
): [unknown, (v: unknown) => void] {
  const settings = useSettings()
  const key = (entry.sliceKey ?? entry.id) as string

  if (entry.id === "theme") {
    return [settings.theme, (v) => settings.setTheme(v as Theme)]
  }

  const value = (settings as unknown as Record<string, unknown>)[key]
  const setterName = `set${key.charAt(0).toUpperCase()}${key.slice(1)}`
  const setter = (settings as unknown as Record<string, unknown>)[setterName] as
    | ((v: unknown) => void)
    | undefined

  return [
    value,
    (v) => {
      if (typeof setter === "function") setter(v)
    },
  ]
}

export const CatalogSettingRow: React.FC<{
  entry: SettingCatalogEntry
  highlighted?: boolean
}> = ({ entry, highlighted }) => {
  const [value, onChange] = useCatalogValue(entry)
  if (entry.control.kind === "panel") return null
  return (
    <SettingRow
      entry={entry}
      value={value}
      onChange={onChange}
      highlighted={highlighted}
    />
  )
}

export const CommonlyUsedSection: React.FC<{
  highlightId?: string | null
}> = ({ highlightId }) => {
  const entries = commonlyUsedEntries()
  return (
    // `max-w-2xl` (672px) left most of a 1440px settings pane empty while the
    // rows inside it wrapped. Wider, but still measured — settings rows are
    // label/control pairs, and a full-bleed column puts them absurdly far apart.
    <div className="space-y-2 max-w-4xl">
      <div className="mb-6">
        <h3 className="text-sm uppercase font-bold tracking-widest">
          Commonly Used
        </h3>
        <p className="text-[10px] italic serif opacity-50 mt-1">
          A curated set of frequently adjusted settings.
        </p>
      </div>
      {entries.map((entry) => (
        <CatalogSettingRow
          key={entry.id}
          entry={entry}
          highlighted={highlightId === entry.id}
        />
      ))}
    </div>
  )
}

import type React from "react"
import { CatalogSettingRow } from "@/components/settings/CommonlyUsedSection"
import type {
  SettingCatalogEntry,
  SettingsSearchHit,
} from "@/lib/settings/catalog-types"

export const SettingsSearchResults: React.FC<{
  hits: SettingsSearchHit[]
  highlightId?: string | null
  onSelect: (entry: SettingCatalogEntry) => void
  isModified: (entry: SettingCatalogEntry) => boolean
}> = ({ hits, highlightId, onSelect }) => {
  if (hits.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-[11px] font-mono uppercase tracking-widest opacity-40">
          No settings match
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1 max-w-2xl" data-testid="settings-search-results">
      <p className="text-[10px] font-mono uppercase tracking-widest opacity-40 mb-4">
        {hits.length} result{hits.length === 1 ? "" : "s"}
      </p>
      {hits.map(({ entry }) => {
        if (entry.control.kind === "panel") {
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect(entry)}
              className="w-full text-left py-3 border-b border-app-ink/5 hover:bg-app-ink/5 px-2 -mx-2"
            >
              <div className="text-[10px] font-bold uppercase tracking-tight">
                {entry.label}
              </div>
              <p className="text-[10px] opacity-50 mt-1">{entry.description}</p>
              <span className="text-[8px] font-mono uppercase tracking-widest opacity-30">
                Open panel → {entry.control.sectionId}
              </span>
            </button>
          )
        }
        return (
          <div key={entry.id}>
            <CatalogSettingRow
              entry={entry}
              highlighted={highlightId === entry.id}
            />
          </div>
        )
      })}
    </div>
  )
}

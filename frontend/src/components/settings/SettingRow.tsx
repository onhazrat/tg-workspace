import { Copy, RotateCcw, Settings2 } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { toast } from "sonner"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { TgInput, tgFieldClassName } from "@/components/ui/tg-input"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { TgToggle } from "@/components/ui/tg-toggle"
import {
  isSettingModified,
  settingElementId,
  valuesEqual,
} from "@/lib/settings/catalog"
import type { SettingCatalogEntry } from "@/lib/settings/catalog-types"
import { cn } from "@/lib/utils"
import { SETTING_HIGHLIGHT_CLASS } from "./SettingAnchor"

export interface SettingRowProps {
  entry: SettingCatalogEntry
  value: unknown
  onChange: (value: unknown) => void
  onReset?: () => void
  /** Deep-link highlight */
  highlighted?: boolean
  id?: string
}

export const SettingRow: React.FC<SettingRowProps> = ({
  entry,
  value,
  onChange,
  onReset,
  highlighted = false,
  id,
}) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const isModified = isSettingModified(entry, value)
  const rowId = id ?? settingElementId(entry.id)

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(entry.id)
      toast.success(`Copied “${entry.id}”`)
    } catch {
      toast.error("Could not copy setting id")
    }
    setMenuOpen(false)
  }

  const handleReset = () => {
    onChange(entry.defaultValue)
    onReset?.()
    setMenuOpen(false)
  }

  return (
    <div
      id={rowId}
      data-setting-id={entry.id}
      data-modified={isModified ? "true" : undefined}
      className={cn(
        "group relative flex flex-col gap-2 py-3 border-b border-app-ink/5 scroll-mt-24",
        isModified && "border-l-2 border-l-amber-500/70 pl-3 -ml-0.5",
        highlighted && SETTING_HIGHLIGHT_CLASS,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-tight">
              {entry.label}
            </span>
            {isModified && (
              <span className="text-[8px] font-mono uppercase tracking-widest text-amber-600/80">
                Modified
              </span>
            )}
          </div>
          {entry.description ? (
            <p className="text-[10px] opacity-50 mt-1 leading-relaxed">
              {entry.description}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {entry.control.kind === "boolean" && (
            <TgToggle
              checked={Boolean(value)}
              onClick={() => onChange(!value)}
              aria-label={entry.label}
            />
          )}
          {entry.control.kind === "number" && (
            <TgInput
              type="number"
              min={entry.control.min}
              max={entry.control.max}
              step={entry.control.step === "any" ? "any" : entry.control.step}
              value={typeof value === "number" ? value : Number(value) || 0}
              onChange={(e) => {
                const raw = e.target.value
                const parsed =
                  entry.control.kind === "number" &&
                  entry.control.step === "any"
                    ? Number.parseFloat(raw)
                    : Number.parseInt(raw, 10)
                if (!Number.isNaN(parsed)) onChange(parsed)
              }}
              className="w-24 p-2 normal-case tracking-normal rounded"
              aria-label={entry.label}
            />
          )}
          {entry.control.kind === "enum" &&
          entry.control.options.length <= 4 ? (
            <TgSegmentedControl
              size="dense"
              className="w-fit"
              aria-label={entry.label}
              value={String(value)}
              onChange={(v) => onChange(v)}
              options={entry.control.options.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
            />
          ) : null}
          {entry.control.kind === "enum" && entry.control.options.length > 4 ? (
            <select
              value={String(value)}
              onChange={(e) => onChange(e.target.value)}
              className={tgFieldClassName}
              aria-label={entry.label}
            >
              {entry.control.options.map((o) => (
                <option
                  key={o.value}
                  value={o.value}
                  className="bg-app-card text-app-ink"
                >
                  {o.label}
                </option>
              ))}
            </select>
          ) : null}

          <div className="relative">
            <TgIconButton
              aria-label={`Options for ${entry.label}`}
              tooltip="Setting options"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Settings2 size={14} />
            </TgIconButton>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 min-w-[10rem] border border-app-ink/15 bg-app-card shadow-md py-1">
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[10px] uppercase tracking-widest hover:bg-app-ink/5 disabled:opacity-30"
                  disabled={!isModified}
                  onClick={handleReset}
                >
                  <RotateCcw size={12} />
                  Reset to default
                </button>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[10px] uppercase tracking-widest hover:bg-app-ink/5"
                  onClick={handleCopyId}
                >
                  <Copy size={12} />
                  Copy ID
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function settingValueChanged(
  entry: SettingCatalogEntry,
  value: unknown,
): boolean {
  return !valuesEqual(value, entry.defaultValue)
}

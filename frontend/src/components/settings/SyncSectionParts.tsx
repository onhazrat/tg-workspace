import { Database } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type { JobStatusEntry } from "@/api/jobs"
import { TgButton } from "@/components/ui/tg-button"
import { TgHelpText, TgInput } from "@/components/ui/tg-input"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import type { GlobalStartTimeMode, GlobalStartTimeValue } from "@/types"
import { SettingAnchor } from "./SettingAnchor"

type StartTimeSettingProps = {
  highlightId: string | null
  mode: GlobalStartTimeMode
  value: GlobalStartTimeValue
  effectiveStartTime: number
  postRetentionDays: number
  onModeChange: (mode: GlobalStartTimeMode) => void
  onValueChange: (value: GlobalStartTimeValue) => void
}

export function StartTimeSetting({
  highlightId,
  mode,
  value,
  effectiveStartTime,
  postRetentionDays,
  onModeChange,
  onValueChange,
}: StartTimeSettingProps) {
  return (
    <SettingAnchor
      settingId="globalStartTimeMode"
      highlighted={highlightId === "globalStartTimeMode"}
      className="space-y-4 pt-4 border-t border-app-ink/5"
    >
      <div className="flex items-center gap-2 opacity-60 mb-2">
        <Database size={14} />
        <span className="text-[10px] font-bold uppercase tracking-tight">
          Default Channel Start Time
        </span>
      </div>
      <TgHelpText className="mb-4">
        When adding a new channel, start scraping from this time.
      </TgHelpText>

      <TgSegmentedControl
        size="sm"
        className="w-full"
        optionClassName="flex-1"
        aria-label="Default channel start time"
        value={mode}
        onChange={(next) => {
          onModeChange(next)
          if (next === "relative" && typeof value !== "number") {
            onValueChange(1)
          }
        }}
        options={[
          { value: "retention", label: "Match Retention" },
          { value: "relative", label: "Relative" },
          { value: "absolute", label: "Absolute" },
        ]}
      />

      <AnimatePresence mode="wait">
        {mode === "relative" && (
          <motion.div
            key="relative"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="pt-2"
          >
            <SettingAnchor
              settingId="globalStartTimeValue"
              highlighted={highlightId === "globalStartTimeValue"}
              className="flex items-center gap-3"
            >
              <TgInput
                type="number"
                min="1"
                value={typeof value === "number" ? value : 1}
                onChange={(e) =>
                  onValueChange(parseInt(e.target.value, 10) || 1)
                }
                className="w-20 p-2 normal-case tracking-normal rounded"
              />
              <span className="text-[10px] opacity-60 uppercase tracking-widest font-bold">
                Days Ago
              </span>
            </SettingAnchor>
          </motion.div>
        )}
        {mode === "absolute" && (
          <motion.div
            key="absolute"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="pt-2"
          >
            <SettingAnchor
              settingId="globalStartTimeValue"
              highlighted={highlightId === "globalStartTimeValue"}
            >
              <TgInput
                type="datetime-local"
                value={
                  typeof value === "string"
                    ? value.slice(0, 16)
                    : new Date().toISOString().slice(0, 16)
                }
                onChange={(e) => {
                  if (e.target.value) {
                    const date = new Date(e.target.value)
                    if (!Number.isNaN(date.getTime())) {
                      onValueChange(date.toISOString())
                    }
                  }
                }}
                className="p-2 normal-case tracking-normal rounded"
              />
            </SettingAnchor>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-2 p-2 bg-app-ink/5 border border-app-ink/10 rounded flex items-center justify-between">
        <span className="text-[9px] uppercase font-bold opacity-40">
          Effective Start Date
        </span>
        <span className="text-[10px] font-mono font-bold tracking-wider">
          {new Date(effectiveStartTime).toLocaleString()}
        </span>
      </div>
      {postRetentionDays > 0 && (
        <p className="text-[8px] opacity-40 italic serif text-right">
          Clamped by {postRetentionDays} days retention policy.
        </p>
      )}
    </SettingAnchor>
  )
}

const STATUS_COLORS = new Map([
  ["ok", "text-green-600"],
  ["error", "text-red-500"],
  ["running", "text-amber-600"],
])

type JobRowProps = {
  label: string
  entry: JobStatusEntry | undefined
  triggering: boolean
  onToggle: (enabled: boolean) => void
  onRun: () => void
}

export function JobRow({
  label,
  entry,
  triggering,
  onToggle,
  onRun,
}: JobRowProps) {
  const enabled = entry?.enabled !== false
  return (
    <div className="flex items-center justify-between gap-3 p-3 border border-app-ink/10 rounded-md bg-app-muted/30">
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-tight">
          {label}
        </div>
        <div
          className={`text-[9px] font-mono uppercase ${STATUS_COLORS.get(entry?.lastStatus ?? "") ?? "text-app-ink/50"}`}
        >
          {entry?.lastStatus || "—"}
          {entry?.lastError ? ` · ${entry.lastError.slice(0, 60)}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onToggle(!(entry?.enabled ?? true))}
          className={`w-8 h-4 transition-all relative border border-app-ink/20 rounded-sm ${
            enabled ? "bg-green-500 border-green-600" : "bg-app-ink/10"
          }`}
          title={enabled ? "Disable job" : "Enable job"}
        >
          <div
            className={`absolute top-0.5 w-2.5 h-2.5 bg-white transition-all rounded-sm ${
              enabled ? "left-4" : "left-0.5"
            }`}
          />
        </button>
        <TgButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRun}
          loading={triggering}
          loadingLabel="…"
        >
          Run
        </TgButton>
      </div>
    </div>
  )
}

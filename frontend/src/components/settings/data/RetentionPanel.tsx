import { Activity, Compass, Database } from "lucide-react"
import type React from "react"
import { SettingAnchor } from "@/components/settings/SettingAnchor"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"

type RetentionPanelProps = {
  postRetentionDays: number
  logRetentionDays: number
  reportRetentionDays: number
  reportRetentionMax: number
  onPostRetentionDaysChange: (days: number) => void
  onLogRetentionDaysChange: (days: number) => void
  onReportRetentionDaysChange: (days: number) => void
  onReportRetentionMaxChange: (count: number) => void
  highlightId?: string | null
}

export const RetentionPanel: React.FC<RetentionPanelProps> = ({
  postRetentionDays,
  logRetentionDays,
  reportRetentionDays,
  reportRetentionMax,
  onPostRetentionDaysChange,
  onLogRetentionDaysChange,
  onReportRetentionDaysChange,
  onReportRetentionMaxChange,
  highlightId = null,
}) => (
  <TgSettingsSection icon={Database} title="Data Retention" className="mb-8">
    <div className="space-y-6">
      <SettingAnchor
        settingId="postRetentionDays"
        highlighted={highlightId === "postRetentionDays"}
        className="space-y-4"
      >
        <div className="flex items-center gap-2 opacity-60">
          <Database size={14} />
          <span className="text-[10px] font-bold uppercase tracking-tight">
            Post Retention
          </span>
        </div>
        <input
          type="number"
          min={0}
          step={1}
          value={postRetentionDays}
          onChange={(e) => {
            const val = Number.parseInt(e.target.value, 10)
            onPostRetentionDaysChange(!Number.isNaN(val) && val >= 0 ? val : 0)
          }}
          className="w-full bg-app-bg border border-app-ink/20 p-2 text-[11px] font-mono focus:border-app-ink focus:outline-none transition-colors"
        />
        {postRetentionDays === 0 && (
          <p className="text-[10px] opacity-60 italic serif">
            Never Delete — posts are kept forever.
          </p>
        )}
        <p className="text-[10px] opacity-40 italic serif">
          Automatically delete posts older than the selected timeframe.
          Summaries and chat history are always preserved.
        </p>
      </SettingAnchor>

      <SettingAnchor
        settingId="logRetentionDays"
        highlighted={highlightId === "logRetentionDays"}
        className="space-y-4"
      >
        <div className="flex items-center gap-2 opacity-60">
          <Activity size={14} />
          <span className="text-[10px] font-bold uppercase tracking-tight">
            Log Retention
          </span>
        </div>
        <input
          type="number"
          min={0}
          step={1}
          value={logRetentionDays}
          onChange={(e) => {
            const val = Number.parseInt(e.target.value, 10)
            onLogRetentionDaysChange(!Number.isNaN(val) && val >= 0 ? val : 0)
          }}
          className="w-full bg-app-bg border border-app-ink/20 p-2 text-[11px] font-mono focus:border-app-ink focus:outline-none transition-colors"
        />
        {logRetentionDays === 0 && (
          <p className="text-[10px] opacity-60 italic serif">
            Never Delete — logs are kept forever.
          </p>
        )}
        <p className="text-[10px] opacity-40 italic serif">
          Automatically delete system logs (sync, network, AI) older than the
          selected timeframe.
        </p>
      </SettingAnchor>

      <SettingAnchor
        settingId="reportRetentionDays"
        highlighted={highlightId === "reportRetentionDays"}
        className="space-y-4"
      >
        <div className="flex items-center gap-2 opacity-60">
          <Compass size={14} />
          <span className="text-[10px] font-bold uppercase tracking-tight">
            Discover Report Retention
          </span>
        </div>
        <input
          type="number"
          min={0}
          step={1}
          value={reportRetentionDays}
          onChange={(e) => {
            const val = Number.parseInt(e.target.value, 10)
            onReportRetentionDaysChange(
              !Number.isNaN(val) && val >= 0 ? val : 0,
            )
          }}
          className="w-full bg-app-bg border border-app-ink/20 p-2 text-[11px] font-mono focus:border-app-ink focus:outline-none transition-colors"
        />
        {reportRetentionDays === 0 && (
          <p className="text-[10px] opacity-60 italic serif">
            Never Delete — reports are kept regardless of age.
          </p>
        )}
        <p className="text-[10px] opacity-40 italic serif">
          Age limit for saved Discover reports, in days. Each report stores its
          full candidate list, so they are the one table that grows every time
          you generate one.
        </p>
      </SettingAnchor>

      <SettingAnchor
        settingId="reportRetentionMax"
        highlighted={highlightId === "reportRetentionMax"}
        className="space-y-4"
      >
        <div className="flex items-center gap-2 opacity-60">
          <Compass size={14} />
          <span className="text-[10px] font-bold uppercase tracking-tight">
            Discover Report Limit
          </span>
        </div>
        <input
          type="number"
          min={0}
          step={1}
          value={reportRetentionMax}
          onChange={(e) => {
            const val = Number.parseInt(e.target.value, 10)
            onReportRetentionMaxChange(!Number.isNaN(val) && val >= 0 ? val : 0)
          }}
          className="w-full bg-app-bg border border-app-ink/20 p-2 text-[11px] font-mono focus:border-app-ink focus:outline-none transition-colors"
        />
        {reportRetentionMax === 0 && (
          <p className="text-[10px] opacity-60 italic serif">
            No Limit — any number of reports are kept.
          </p>
        )}
        <p className="text-[10px] opacity-40 italic serif">
          Keep only this many of the newest reports. Both limits apply,
          whichever removes a report first, and neither spares the newest one —
          set both to 0 to keep everything.
        </p>
      </SettingAnchor>
    </div>
  </TgSettingsSection>
)

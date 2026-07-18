import { Activity, Database } from "lucide-react"
import type React from "react"
import { SettingAnchor } from "@/components/settings/SettingAnchor"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"

type RetentionPanelProps = {
  postRetentionDays: number
  logRetentionDays: number
  onPostRetentionDaysChange: (days: number) => void
  onLogRetentionDaysChange: (days: number) => void
  highlightId?: string | null
}

export const RetentionPanel: React.FC<RetentionPanelProps> = ({
  postRetentionDays,
  logRetentionDays,
  onPostRetentionDaysChange,
  onLogRetentionDaysChange,
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
    </div>
  </TgSettingsSection>
)

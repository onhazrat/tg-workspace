import { Info, Layout, Monitor, Moon, Sun } from "lucide-react"
import type React from "react"
import { SettingAnchor } from "@/components/settings/SettingAnchor"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import { TgToggle } from "@/components/ui/tg-toggle"
import { useSettings } from "@/contexts/SettingsContext"
import { APP_VERSION } from "@/lib/app-version"

export const AppearanceSection: React.FC<{
  highlightId?: string | null
}> = ({ highlightId = null }) => {
  const {
    theme,
    setTheme,
    showChannelBio,
    setShowChannelBio,
    showChannelSubscribers,
    setShowChannelSubscribers,
    showChannelTelegramChatId,
    setShowChannelTelegramChatId,
    showChannelPhotos,
    setShowChannelPhotos,
    showChannelVideos,
    setShowChannelVideos,
    showChannelFiles,
    setShowChannelFiles,
    showChannelLinks,
    setShowChannelLinks,
    showChannelStartId,
    setShowChannelStartId,
  } = useSettings()

  return (
    <div className="space-y-8 lg:col-span-2">
      <TgSettingsSection icon={Layout} title="Interface & Appearance">
        <div className="space-y-8">
          <SettingAnchor
            settingId="theme"
            highlighted={highlightId === "theme"}
            className="space-y-4"
          >
            <div className="flex items-center gap-2 opacity-60">
              <Sun size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tight">
                Color Theme
              </span>
            </div>
            <TgSegmentedControl
              size="dense"
              className="w-fit"
              aria-label="Color theme"
              value={theme}
              onChange={setTheme}
              options={[
                {
                  value: "light",
                  label: (
                    <>
                      <Sun size={12} /> Light
                    </>
                  ),
                },
                {
                  value: "dark",
                  label: (
                    <>
                      <Moon size={12} /> Dark
                    </>
                  ),
                },
                {
                  value: "system",
                  label: (
                    <>
                      <Monitor size={12} /> System
                    </>
                  ),
                  "data-testid": "system-mode",
                },
              ]}
            />
          </SettingAnchor>
        </div>
      </TgSettingsSection>

      <TgSettingsSection icon={Info} title="System Information">
        <div className="space-y-6">
          <p className="text-[10px] leading-relaxed opacity-60 italic serif">
            This dashboard is designed for high-speed monitoring and analysis of
            Telegram channels. Channels, posts and summaries are stored in this
            deployment's PostgreSQL database; your browser keeps a local cache
            so the app stays readable when the server is unreachable. Data
            leaves the deployment only for Telegram scraping and for the AI
            provider you have configured.
          </p>

          <div className="space-y-3 pt-4 border-t border-app-ink/5">
            <div className="flex justify-between text-[9px] font-mono uppercase tracking-widest">
              <span className="opacity-40">Version</span>
              <span data-testid="app-version">{APP_VERSION}</span>
            </div>
            <div className="flex justify-between text-[9px] font-mono uppercase tracking-widest">
              <span className="opacity-40">Storage</span>
              <span>PostgreSQL · IndexedDB cache</span>
            </div>
            <div className="flex justify-between text-[9px] font-mono uppercase tracking-widest">
              <span className="opacity-40">AI Provider</span>
              <span>Configurable · Gemini</span>
            </div>
          </div>
        </div>
      </TgSettingsSection>

      <TgSettingsSection icon={Layout} title="Channel Card Display">
        <div className="space-y-6">
          <SettingAnchor
            settingId="showChannelBio"
            highlighted={highlightId === "showChannelBio"}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 opacity-60">
                <span className="text-[10px] font-bold uppercase tracking-tight">
                  Show Bio
                </span>
              </div>
              <TgToggle
                checked={showChannelBio}
                onClick={() => setShowChannelBio(!showChannelBio)}
                aria-label="Show bio"
              />
            </div>
          </SettingAnchor>

          <SettingAnchor
            settingId="showChannelTelegramChatId"
            highlighted={highlightId === "showChannelTelegramChatId"}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 opacity-60">
                <span className="text-[10px] font-bold uppercase tracking-tight">
                  Show Telegram Chat ID
                </span>
              </div>
              <TgToggle
                checked={showChannelTelegramChatId}
                onClick={() =>
                  setShowChannelTelegramChatId(!showChannelTelegramChatId)
                }
                aria-label="Show Telegram chat ID"
              />
            </div>
          </SettingAnchor>

          <SettingAnchor
            settingId="showChannelSubscribers"
            highlighted={highlightId === "showChannelSubscribers"}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 opacity-60">
                <span className="text-[10px] font-bold uppercase tracking-tight">
                  Show Subscribers
                </span>
              </div>
              <TgToggle
                checked={showChannelSubscribers}
                onClick={() =>
                  setShowChannelSubscribers(!showChannelSubscribers)
                }
                aria-label="Show subscribers"
              />
            </div>
          </SettingAnchor>

          <SettingAnchor
            settingId="showChannelPhotos"
            highlighted={highlightId === "showChannelPhotos"}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 opacity-60">
                <span className="text-[10px] font-bold uppercase tracking-tight">
                  Show Photos Count
                </span>
              </div>
              <TgToggle
                checked={showChannelPhotos}
                onClick={() => setShowChannelPhotos(!showChannelPhotos)}
                aria-label="Show photos count"
              />
            </div>
          </SettingAnchor>

          <SettingAnchor
            settingId="showChannelVideos"
            highlighted={highlightId === "showChannelVideos"}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 opacity-60">
                <span className="text-[10px] font-bold uppercase tracking-tight">
                  Show Videos Count
                </span>
              </div>
              <TgToggle
                checked={showChannelVideos}
                onClick={() => setShowChannelVideos(!showChannelVideos)}
                aria-label="Show videos count"
              />
            </div>
          </SettingAnchor>

          <SettingAnchor
            settingId="showChannelFiles"
            highlighted={highlightId === "showChannelFiles"}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 opacity-60">
                <span className="text-[10px] font-bold uppercase tracking-tight">
                  Show Files Count
                </span>
              </div>
              <TgToggle
                checked={showChannelFiles}
                onClick={() => setShowChannelFiles(!showChannelFiles)}
                aria-label="Show files count"
              />
            </div>
          </SettingAnchor>

          <SettingAnchor
            settingId="showChannelLinks"
            highlighted={highlightId === "showChannelLinks"}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 opacity-60">
                <span className="text-[10px] font-bold uppercase tracking-tight">
                  Show Links Count
                </span>
              </div>
              <TgToggle
                checked={showChannelLinks}
                onClick={() => setShowChannelLinks(!showChannelLinks)}
                aria-label="Show links count"
              />
            </div>
          </SettingAnchor>

          <SettingAnchor
            settingId="showChannelStartId"
            highlighted={highlightId === "showChannelStartId"}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 opacity-60">
                <span className="text-[10px] font-bold uppercase tracking-tight">
                  Show Start ID (Advanced)
                </span>
              </div>
              <TgToggle
                checked={showChannelStartId}
                onClick={() => setShowChannelStartId(!showChannelStartId)}
                aria-label="Show start ID"
              />
            </div>
          </SettingAnchor>
        </div>
      </TgSettingsSection>
    </div>
  )
}

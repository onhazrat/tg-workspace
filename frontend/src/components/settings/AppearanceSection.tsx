import { Info, Layout, Monitor, Moon, Sun } from "lucide-react"
import type React from "react"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import { TgToggle } from "@/components/ui/tg-toggle"
import { useSettings } from "@/contexts/SettingsContext"

export const AppearanceSection: React.FC = () => {
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
          <div className="space-y-4">
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
          </div>
        </div>
      </TgSettingsSection>

      <TgSettingsSection icon={Info} title="System Information">
        <div className="space-y-6">
          <p className="text-[10px] leading-relaxed opacity-60 italic serif">
            This dashboard is designed for high-speed monitoring and analysis of
            Telegram channels. All data is stored locally in your browser's
            IndexedDB. AI processing is powered by Google Gemini. No data is
            sent to external servers except for Telegram scraping and AI
            analysis.
          </p>

          <div className="space-y-3 pt-4 border-t border-app-ink/5">
            <div className="flex justify-between text-[9px] font-mono uppercase tracking-widest">
              <span className="opacity-40">Core Version</span>
              <span>2.5.0-stable</span>
            </div>
            <div className="flex justify-between text-[9px] font-mono uppercase tracking-widest">
              <span className="opacity-40">Storage Engine</span>
              <span>IndexedDB (idb)</span>
            </div>
            <div className="flex justify-between text-[9px] font-mono uppercase tracking-widest">
              <span className="opacity-40">AI Provider</span>
              <span>Google Gemini API</span>
            </div>
          </div>
        </div>
      </TgSettingsSection>

      <TgSettingsSection icon={Layout} title="Channel Card Display">
        <div className="space-y-6">
          <div className="space-y-4">
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
          </div>

          <div className="space-y-4">
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
          </div>

          <div className="space-y-4">
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
          </div>

          <div className="space-y-4">
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
          </div>

          <div className="space-y-4">
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
          </div>

          <div className="space-y-4">
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
          </div>

          <div className="space-y-4">
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
          </div>

          <div className="space-y-4">
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
          </div>
        </div>
      </TgSettingsSection>
    </div>
  )
}

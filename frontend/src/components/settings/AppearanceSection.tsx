import { Info, Layout, Monitor, Moon, Sun } from "lucide-react"
import type React from "react"
import { useSettings } from "@/contexts/SettingsContext"
import { ToggleSwitch } from "./ToggleSwitch"

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
      <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <Layout size={18} className="opacity-40" />
          <h4 className="text-[11px] uppercase font-bold tracking-widest">
            Interface & Appearance
          </h4>
        </div>

        <div className="space-y-8">
          <div className="space-y-4">
            <div className="flex items-center gap-2 opacity-60">
              <Sun size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tight">
                Color Theme
              </span>
            </div>
            <div className="flex gap-2 p-1 bg-app-ink/5 border border-app-ink/10 w-fit">
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${
                  theme === "light"
                    ? "bg-app-ink text-app-bg"
                    : "opacity-40 hover:opacity-100"
                }`}
              >
                <Sun size={12} /> Light
              </button>
              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${
                  theme === "dark"
                    ? "bg-app-ink text-app-bg"
                    : "opacity-40 hover:opacity-100"
                }`}
              >
                <Moon size={12} /> Dark
              </button>
              <button
                type="button"
                data-testid="system-mode"
                onClick={() => setTheme("system")}
                className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${
                  theme === "system"
                    ? "bg-app-ink text-app-bg"
                    : "opacity-40 hover:opacity-100"
                }`}
              >
                <Monitor size={12} /> System
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* System Info */}
      <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <Info size={18} className="opacity-40" />
          <h4 className="text-[11px] uppercase font-bold tracking-widest">
            System Information
          </h4>
        </div>

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
      </div>

      <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm mt-8">
        <div className="flex items-center gap-3 mb-6">
          <Layout size={18} className="opacity-40" />
          <h4 className="text-[11px] uppercase font-bold tracking-widest">
            Channel Card Display
          </h4>
        </div>

        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 opacity-60">
                <span className="text-[10px] font-bold uppercase tracking-tight">
                  Show Bio
                </span>
              </div>
              <ToggleSwitch
                checked={showChannelBio}
                onClick={() => setShowChannelBio(!showChannelBio)}
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
              <ToggleSwitch
                checked={showChannelTelegramChatId}
                onClick={() =>
                  setShowChannelTelegramChatId(!showChannelTelegramChatId)
                }
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
              <ToggleSwitch
                checked={showChannelSubscribers}
                onClick={() =>
                  setShowChannelSubscribers(!showChannelSubscribers)
                }
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
              <ToggleSwitch
                checked={showChannelPhotos}
                onClick={() => setShowChannelPhotos(!showChannelPhotos)}
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
              <ToggleSwitch
                checked={showChannelVideos}
                onClick={() => setShowChannelVideos(!showChannelVideos)}
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
              <ToggleSwitch
                checked={showChannelFiles}
                onClick={() => setShowChannelFiles(!showChannelFiles)}
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
              <ToggleSwitch
                checked={showChannelLinks}
                onClick={() => setShowChannelLinks(!showChannelLinks)}
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
              <ToggleSwitch
                checked={showChannelStartId}
                onClick={() => setShowChannelStartId(!showChannelStartId)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

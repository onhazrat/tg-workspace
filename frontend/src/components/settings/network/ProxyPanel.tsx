import { Globe } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useEffect, useState } from "react"
import { api } from "@/api"
import type { BadProxy } from "@/client"
import { SettingAnchor } from "@/components/settings/SettingAnchor"
import { TgHelpText } from "@/components/ui/tg-input"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import { TgToggle } from "@/components/ui/tg-toggle"
import { useSettings } from "@/contexts/SettingsContext"
import { maskProxyUrl } from "@/lib/network/maskProxyUrl"
import { parseProxyList } from "@/lib/syncSettings"
import {
  BlacklistedProxies,
  ProxyListEditor,
  ProxySlots,
} from "./ProxyPanelSections"
import { ProxyTestResults } from "./ProxyTestResults"
import { useProxyTesting } from "./useProxyTesting"

export const ProxyPanel: React.FC<{
  highlightId?: string | null
}> = ({ highlightId = null }) => {
  const {
    proxyEnabled,
    setProxyEnabled,
    defaultProxyUrls,
    setDefaultProxyUrls,
    proxyDefaultConcurrency,
    setProxyDefaultConcurrency,
    proxyConcurrencyOverrides,
    setProxyConcurrencyOverrides,
    envFallbackConfigured,
  } = useSettings()

  const {
    proxyTestResults,
    isTestingAll,
    handleTestAllProxies,
    clearProxyResults,
  } = useProxyTesting()

  const [badProxies, setBadProxies] = useState<BadProxy[]>([])

  // Credentials stay masked until revealed; `ProxyListEditor` says why.
  const [revealCredentials, setRevealCredentials] = useState(false)

  /** Proxy URL as it should be shown — masked unless the user revealed them. */
  const displayProxyUrl = (url: string): string =>
    revealCredentials ? url : maskProxyUrl(url)

  const fetchProxyHealth = async () => {
    try {
      const data = await api.proxyHealth()
      setBadProxies(data.badProxies ?? [])
    } catch (error) {
      console.error("Failed to fetch proxy health:", error)
    }
  }

  useEffect(() => {
    fetchProxyHealth()
    const interval = setInterval(fetchProxyHealth, 10000)
    return () => clearInterval(interval)
  }, [fetchProxyHealth])

  return (
    <TgSettingsSection icon={Globe} title="Network & Proxy">
      <div className="space-y-6">
        <SettingAnchor
          settingId="proxyEnabled"
          highlighted={highlightId === "proxyEnabled"}
          className="space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 opacity-60">
              <Globe size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tight">
                Enable Proxies
              </span>
            </div>
            <TgToggle
              checked={proxyEnabled}
              onClick={() => setProxyEnabled(!proxyEnabled)}
            />
          </div>
          <TgHelpText>
            Rotate through proxy servers to avoid Telegram rate limits.
          </TgHelpText>
        </SettingAnchor>

        <AnimatePresence>
          {proxyEnabled && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4 overflow-hidden"
            >
              <ProxyListEditor
                urls={defaultProxyUrls}
                onChange={setDefaultProxyUrls}
                revealed={revealCredentials}
                onRevealedChange={setRevealCredentials}
                hasResults={Object.keys(proxyTestResults).length > 0}
                onClearResults={clearProxyResults}
                isTestingAll={isTestingAll}
                onTestAll={() => handleTestAllProxies(defaultProxyUrls)}
                highlightId={highlightId}
              />

              <ProxySlots
                proxies={parseProxyList(defaultProxyUrls)}
                defaultSlots={proxyDefaultConcurrency}
                onDefaultSlotsChange={setProxyDefaultConcurrency}
                overrides={proxyConcurrencyOverrides}
                onOverridesChange={setProxyConcurrencyOverrides}
                display={displayProxyUrl}
                highlightId={highlightId}
              />

              <ProxyTestResults
                list={defaultProxyUrls}
                results={proxyTestResults}
                display={displayProxyUrl}
              />

              <BlacklistedProxies proxies={badProxies} />

              <TgHelpText>
                Your proxy list is saved to your account on the server.
                {envFallbackConfigured && (
                  <>
                    {" "}
                    When empty and proxies are enabled, the server falls back to{" "}
                    <code className="font-mono">DEFAULT_PROXY_URLS</code> env.
                  </>
                )}
              </TgHelpText>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </TgSettingsSection>
  )
}

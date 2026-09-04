import {
  Activity,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  RotateCw,
  Shield,
  XCircle,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useEffect, useState } from "react"
import { api } from "@/api"
import type { BadProxy } from "@/client"
import { SettingAnchor } from "@/components/settings/SettingAnchor"
import { TgButton } from "@/components/ui/tg-button"
import { TgHelpText, TgInput, TgTextarea } from "@/components/ui/tg-input"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import { TgToggle } from "@/components/ui/tg-toggle"
import { useSettings } from "@/contexts/SettingsContext"
import {
  hasProxyCredentials,
  maskProxyList,
  maskProxyUrl,
} from "@/lib/network/maskProxyUrl"
import {
  effectiveProxyCapacity,
  normalizeProxyUrl,
  slotsForProxy,
} from "@/lib/settings/proxy-concurrency"
import { parseProxyList } from "@/lib/syncSettings"
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

  // Credentials are hidden until explicitly revealed. While hidden the textarea is
  // read-only and shows a masked projection, so there is no code path that can
  // write `***` back into the setting — the masked text is never an input value.
  const [revealCredentials, setRevealCredentials] = useState(false)
  const listHasCredentials = hasProxyCredentials(defaultProxyUrls)
  const credentialsHidden = listHasCredentials && !revealCredentials

  const proxyLines = parseProxyList(defaultProxyUrls)

  /** Proxy URL as it should be shown — masked unless the user revealed them. */
  const displayProxyUrl = (url: string): string =>
    revealCredentials ? url : maskProxyUrl(url)

  const slotsForProxyUrl = (url: string): number =>
    slotsForProxy(url, proxyConcurrencyOverrides, proxyDefaultConcurrency)

  const proxyCapacity = effectiveProxyCapacity(
    proxyLines,
    proxyConcurrencyOverrides,
    proxyDefaultConcurrency,
  )

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
              <SettingAnchor
                settingId="defaultProxyUrls"
                highlighted={highlightId === "defaultProxyUrls"}
                className="space-y-4"
              >
                <div className="flex items-center justify-between opacity-60">
                  <span className="text-[10px] font-bold uppercase tracking-tight">
                    Proxy List (HTTP/SOCKS5)
                  </span>
                  <div className="flex gap-3">
                    {listHasCredentials && (
                      <TgButton
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() => setRevealCredentials((prev) => !prev)}
                        aria-label={
                          revealCredentials
                            ? "Hide proxy credentials"
                            : "Reveal proxy credentials to edit"
                        }
                      >
                        {revealCredentials ? (
                          <EyeOff size={10} />
                        ) : (
                          <Eye size={10} />
                        )}
                        {revealCredentials ? "Hide" : "Reveal"}
                      </TgButton>
                    )}
                    {Object.keys(proxyTestResults).length > 0 && (
                      <TgButton
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={clearProxyResults}
                        className="opacity-60"
                      >
                        Clear
                      </TgButton>
                    )}
                    <TgButton
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => handleTestAllProxies(defaultProxyUrls)}
                      loading={isTestingAll}
                      loadingLabel="Test All"
                    >
                      <Activity size={10} />
                      Test All
                    </TgButton>
                  </div>
                </div>
                <TgTextarea
                  value={
                    credentialsHidden
                      ? maskProxyList(defaultProxyUrls)
                      : defaultProxyUrls
                  }
                  onChange={(e) => setDefaultProxyUrls(e.target.value)}
                  // Read-only while masked: the displayed value is a projection,
                  // not the setting, so editing it would persist `***`.
                  readOnly={credentialsHidden}
                  onBlur={() => setRevealCredentials(false)}
                  placeholder="http://user:pass@host:port or socks5h://host:port (one per line)"
                  className={`h-32 resize-none normal-case tracking-normal ${
                    credentialsHidden ? "cursor-not-allowed" : ""
                  }`}
                />
                {credentialsHidden && (
                  <TgHelpText>
                    Credentials are hidden. Choose <strong>Reveal</strong> to
                    edit the list.
                  </TgHelpText>
                )}
              </SettingAnchor>

              <div className="space-y-3 pt-2 border-t border-app-ink/5">
                <SettingAnchor
                  settingId="proxyDefaultConcurrency"
                  highlighted={highlightId === "proxyDefaultConcurrency"}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                    Default slots per proxy
                  </span>
                  <TgInput
                    type="number"
                    min={1}
                    max={20}
                    value={proxyDefaultConcurrency}
                    onChange={(e) =>
                      setProxyDefaultConcurrency(
                        Math.max(
                          1,
                          Math.min(20, parseInt(e.target.value, 10) || 1),
                        ),
                      )
                    }
                    className="w-16 p-2 text-right normal-case tracking-normal"
                  />
                </SettingAnchor>
                {proxyLines.length > 0 && (
                  <SettingAnchor
                    settingId="proxyConcurrencyOverrides"
                    highlighted={highlightId === "proxyConcurrencyOverrides"}
                    className="space-y-2"
                  >
                    <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                      Per-proxy overrides
                    </span>
                    <div className="space-y-1">
                      {proxyLines.map((url) => (
                        <div
                          key={url}
                          className="flex items-center justify-between gap-3 text-[9px] bg-app-ink/5 p-2 border border-app-ink/5 rounded"
                        >
                          <span className="font-mono truncate flex-1 opacity-60">
                            {displayProxyUrl(url)}
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={slotsForProxyUrl(url)}
                            onChange={(e) => {
                              const slots = Math.max(
                                1,
                                Math.min(20, parseInt(e.target.value, 10) || 1),
                              )
                              const norm = normalizeProxyUrl(url)
                              setProxyConcurrencyOverrides({
                                ...proxyConcurrencyOverrides,
                                [norm]: slots,
                              })
                            }}
                            className="w-14 bg-white/50 border border-app-ink/10 p-1 text-[9px] font-mono text-right focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  </SettingAnchor>
                )}
                <p className="text-[8px] opacity-40 italic serif">
                  Effective parallel HTTP capacity ≈{" "}
                  {proxyCapacity || proxyDefaultConcurrency} slot
                  {(proxyCapacity || proxyDefaultConcurrency) === 1 ? "" : "s"}.
                  This is how many channels are scraped at once — there is no
                  separate ceiling to keep below it any more.
                </p>
              </div>

              {/* Proxy Test Results */}
              {Object.keys(proxyTestResults).length > 0 &&
                defaultProxyUrls
                  .split(/[\n,]+/)
                  .some((p) => proxyTestResults[p.trim()]) && (
                  <div className="space-y-1 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                    {defaultProxyUrls
                      .split(/[\n,]+/)
                      .map((p) => p.trim())
                      .filter((p) => p && proxyTestResults[p])
                      .map((url, idx) => {
                        const res = proxyTestResults[url]
                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-[9px] bg-app-ink/5 p-2 border border-app-ink/5 rounded"
                          >
                            <span className="font-mono truncate max-w-[150px] opacity-60">
                              {displayProxyUrl(url)}
                            </span>
                            <div className="flex items-center gap-2">
                              {res.testing ? (
                                <span className="flex items-center gap-1 opacity-40">
                                  <RotateCw size={8} className="animate-spin" />{" "}
                                  Testing...
                                </span>
                              ) : res.success ? (
                                <>
                                  <span className="text-green-600 font-bold flex items-center gap-1">
                                    <CheckCircle2 size={8} /> {res.latency}ms
                                  </span>
                                  <span className="opacity-40 font-mono">
                                    ({res.ip})
                                  </span>
                                </>
                              ) : (
                                <span
                                  className="text-red-600 font-bold flex items-center gap-1"
                                  title={res.error}
                                >
                                  <XCircle size={8} /> Error
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )}

              {/* Blacklisted Proxies Dashboard */}
              {badProxies.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-app-ink/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-tight text-red-600 flex items-center gap-2">
                      <Shield size={10} /> Blacklisted Proxies
                    </span>
                    <span className="text-[8px] opacity-40 uppercase tracking-widest">
                      Auto-Cooldown
                    </span>
                  </div>
                  <div className="space-y-1">
                    {badProxies.map((proxy, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-[9px] bg-red-500/5 p-2 border border-red-500/10 rounded"
                      >
                        <span className="font-mono truncate max-w-[180px] opacity-60">
                          {proxy.url}
                        </span>
                        <span className="text-red-600 font-bold tabular-nums">
                          {Math.floor(proxy.cooldownRemaining / 60)}:
                          {(proxy.cooldownRemaining % 60)
                            .toString()
                            .padStart(2, "0")}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[8px] opacity-30 italic serif">
                    Proxies are temporarily avoided after repeated network
                    failures.
                  </p>
                </div>
              )}

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

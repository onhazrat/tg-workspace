import {
  Activity,
  CheckCircle2,
  Globe,
  RefreshCw,
  RotateCw,
  Shield,
  XCircle,
  Zap,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import { TgButton } from "@/components/ui/tg-button"
import {
  TgFieldLabel,
  TgHelpText,
  TgInput,
  TgTextarea,
} from "@/components/ui/tg-input"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import { TgToggle } from "@/components/ui/tg-toggle"
import { useData } from "@/contexts/DataContext"
import { useSettings } from "@/contexts/SettingsContext"
import { saveNetworkLog } from "@/lib/repository"
import {
  effectiveProxyCapacity,
  normalizeProxyUrl,
  slotsForProxy,
} from "@/lib/settings/proxy-concurrency"
import { parseProxyList } from "@/lib/syncSettings"
import type { NetworkLog } from "@/types"

export const NetworkSection: React.FC = () => {
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
    torAvailable,
    torEnabled,
    setTorEnabled,
    torMode,
    setTorMode,
    torProxyUrls,
    setTorProxyUrls,
    torRotationStrategy,
    setTorRotationStrategy,
    torControlEnabled,
    setTorControlEnabled,
    torControlPort,
    setTorControlPort,
    torAutoRotate,
    setTorAutoRotate,
    torRotationThreshold,
    setTorRotationThreshold,
    advancedMode,
  } = useSettings()
  const { loadNetworkLogs } = useData()

  const [torStatus, setTorStatus] = useState<{
    running: boolean
    socksInUse: boolean
    controlInUse: boolean
    autoSpawned: boolean
  } | null>(null)
  const [torIp, setTorIp] = useState<string | null>(null)
  const [isCheckingIp, setIsCheckingIp] = useState(false)
  const [isChangingIp, setIsChangingIp] = useState(false)
  const [proxyTestResults, setProxyTestResults] = useState<
    Record<
      string,
      {
        success?: boolean
        ip?: string
        latency?: number
        error?: string
        testing?: boolean
      }
    >
  >({})
  const [isTestingAll, setIsTestingAll] = useState(false)
  const [badProxies, setBadProxies] = useState<
    { url: string; cooldownRemaining: number }[]
  >([])

  const proxyLines = parseProxyList(defaultProxyUrls)

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
      setBadProxies(
        data.badProxies as { url: string; cooldownRemaining: number }[],
      )
    } catch (error) {
      console.error("Failed to fetch proxy health:", error)
    }
  }

  useEffect(() => {
    fetchProxyHealth()
    const interval = setInterval(fetchProxyHealth, 10000)
    return () => clearInterval(interval)
  }, [fetchProxyHealth])

  const testProxy = async (proxyUrl: string) => {
    setProxyTestResults((prev) => ({ ...prev, [proxyUrl]: { testing: true } }))
    const startTime = Date.now()
    let status: "success" | "failed" = "failed"
    let errorMsg: string | undefined
    let telemetryData: any = null

    try {
      const data = (await api.testProxy(proxyUrl)) as {
        success?: boolean
        error?: string
      }
      setProxyTestResults((prev) => ({ ...prev, [proxyUrl]: data }))

      if (data.success) {
        status = "success"
      } else {
        errorMsg = data.error || "Proxy test failed"
      }
      telemetryData = data
    } catch (error: any) {
      errorMsg = error.message
      setProxyTestResults((prev) => ({
        ...prev,
        [proxyUrl]: { success: false, error: error.message },
      }))
    } finally {
      const logEntry: NetworkLog = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        url: "/api/v1/network/test-proxy",
        method: "POST",
        status,
        duration: Date.now() - startTime,
        error: errorMsg,
        proxyUsed: proxyUrl,
        telemetry: telemetryData,
        source: "SettingsView.testProxy",
      }
      await saveNetworkLog(logEntry)
      loadNetworkLogs()
    }
  }

  const handleTestAllProxies = async (urls: string) => {
    const list = urls
      .split(/[\n,]+/)
      .map((p) => p.trim())
      .filter((p) => p)
    if (list.length === 0) {
      toast.error("No proxies to test")
      return
    }
    setIsTestingAll(true)
    for (const url of list) {
      await testProxy(url)
    }
    setIsTestingAll(false)
    toast.success("Proxy testing complete")
  }

  const clearProxyResults = () => setProxyTestResults({})

  const changeTorIp = async () => {
    setIsChangingIp(true)
    const startTime = Date.now()
    let status: "success" | "failed" = "failed"
    let errorMsg: string | undefined
    const telemetryData: any = null

    try {
      await api.torNewIdentity(torControlPort)
      status = "success"
      toast.success("New identity requested. IP will change shortly.")
      setTimeout(checkTorIp, 3000)
    } catch (error: any) {
      console.error("Failed to change TOR IP:", error)
      errorMsg = error.message || "Network error while requesting new identity"
      toast.error("Network error while requesting new identity")
    } finally {
      setIsChangingIp(false)
      const logEntry: NetworkLog = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        url: "/api/v1/network/tor-new-identity",
        method: "POST",
        status,
        duration: Date.now() - startTime,
        error: errorMsg,
        proxyUsed: "socks5h://127.0.0.1:9050",
        telemetry: telemetryData,
        source: "SettingsView.changeTorIp",
      }
      await saveNetworkLog(logEntry)
      loadNetworkLogs()
    }
  }

  const checkTorIp = async () => {
    setIsCheckingIp(true)
    const startTime = Date.now()
    let status: "success" | "failed" = "failed"
    let errorMsg: string | undefined
    let telemetryData: any = null

    try {
      const data = await api.torIp()
      setTorIp(data.ip)
      status = "success"
      telemetryData = data
      toast.success(`Current TOR IP: ${data.ip}`)
    } catch (error: any) {
      console.error("Failed to check TOR IP:", error)
      errorMsg = error.message || "Network error while checking TOR IP"
      toast.error("Network error while checking TOR IP")
    } finally {
      setIsCheckingIp(false)
      const logEntry: NetworkLog = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        url: "/api/v1/network/tor-ip",
        method: "GET",
        status,
        duration: Date.now() - startTime,
        error: errorMsg,
        proxyUsed: "socks5h://127.0.0.1:9050",
        telemetry: telemetryData,
        source: "SettingsView.checkTorIp",
      }
      await saveNetworkLog(logEntry)
      loadNetworkLogs()
    }
  }

  const restartTor = async () => {
    try {
      await api.torRestart()
      toast.success("TOR restart initiated")
    } catch (_e) {
      toast.error("Network error while restarting TOR")
    }
  }

  useEffect(() => {
    const checkTorStatus = async () => {
      try {
        const data = await api.torStatus()
        setTorStatus({ ...data, autoSpawned: false })
      } catch (error) {
        console.error("Failed to check TOR status:", error)
      }
    }

    checkTorStatus()
    const interval = setInterval(checkTorStatus, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-8 lg:col-span-2">
      {/* Network & Proxy */}
      {advancedMode && (
        <>
          <TgSettingsSection icon={Globe} title="Network & Proxy">
            <div className="space-y-6">
              <div className="space-y-4">
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
              </div>

              <AnimatePresence>
                {proxyEnabled && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-4 overflow-hidden"
                  >
                    <div className="flex items-center justify-between opacity-60">
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        Proxy List (HTTP/SOCKS5)
                      </span>
                      <div className="flex gap-3">
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
                      value={defaultProxyUrls}
                      onChange={(e) => setDefaultProxyUrls(e.target.value)}
                      placeholder="http://user:pass@host:port or socks5h://host:port (one per line)"
                      className="h-32 resize-none normal-case tracking-normal"
                    />

                    <div className="space-y-3 pt-2 border-t border-app-ink/5">
                      <div className="flex items-center justify-between gap-4">
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
                      </div>
                      {proxyLines.length > 0 && (
                        <div className="space-y-2">
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
                                  {url}
                                </span>
                                <input
                                  type="number"
                                  min={1}
                                  max={20}
                                  value={slotsForProxyUrl(url)}
                                  onChange={(e) => {
                                    const slots = Math.max(
                                      1,
                                      Math.min(
                                        20,
                                        parseInt(e.target.value, 10) || 1,
                                      ),
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
                        </div>
                      )}
                      <p className="text-[8px] opacity-40 italic serif">
                        Effective parallel HTTP capacity ≈{" "}
                        {proxyCapacity || proxyDefaultConcurrency} slot
                        {(proxyCapacity || proxyDefaultConcurrency) === 1
                          ? ""
                          : "s"}
                        . Keep <strong>Sync concurrency</strong> (Scraping &amp;
                        Sync) at or below this when using proxies.
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
                                    {url}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    {res.testing ? (
                                      <span className="flex items-center gap-1 opacity-40">
                                        <RotateCw
                                          size={8}
                                          className="animate-spin"
                                        />{" "}
                                        Testing...
                                      </span>
                                    ) : res.success ? (
                                      <>
                                        <span className="text-green-600 font-bold flex items-center gap-1">
                                          <CheckCircle2 size={8} />{" "}
                                          {res.latency}ms
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
                          When empty and proxies are enabled, the server falls
                          back to{" "}
                          <code className="font-mono">DEFAULT_PROXY_URLS</code>{" "}
                          env.
                        </>
                      )}
                    </TgHelpText>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </TgSettingsSection>

          <TgSettingsSection icon={Shield} title="TOR Network">
            {!torAvailable && (
              <p className="text-[10px] text-amber-700/80 italic serif mb-4">
                Tor is disabled on this server. Set{" "}
                <code className="font-mono">TOR_ENABLED=true</code> and
                configure the Tor sidecar to enable.
              </p>
            )}
            <div className="flex items-center gap-2 mb-6">
              <div
                className={`w-1.5 h-1.5 rounded-full ${torStatus?.running ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-red-500"}`}
              />
              <span className="text-[9px] font-bold uppercase tracking-widest opacity-60">
                {torStatus?.running ? "Active" : "Inactive"}
              </span>
            </div>

            <div className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 opacity-60">
                    <Shield size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Enable TOR Proxy
                    </span>
                  </div>
                  <TgToggle
                    checked={torEnabled}
                    onClick={() => setTorEnabled(!torEnabled)}
                  />
                </div>
                <TgHelpText>
                  Use TOR to anonymize requests and bypass geographic
                  restrictions.
                </TgHelpText>
              </div>

              <AnimatePresence>
                {torEnabled && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-6 overflow-hidden pt-4"
                  >
                    {/* Status Dashboard */}
                    <div className="flex items-center justify-between bg-app-ink/5 p-4 rounded-xl border border-app-ink/10">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full ${torStatus?.running ? "bg-green-500 animate-pulse" : "bg-red-500"}`}
                        />
                        <span className="text-[10px] font-bold uppercase tracking-widest">
                          Network Status
                        </span>
                      </div>
                      <div className="flex gap-2">
                        {torStatus?.running ? (
                          <span className="px-2 py-0.5 bg-green-500/10 text-green-600 text-[8px] font-bold uppercase rounded border border-green-500/20 flex items-center gap-1">
                            <CheckCircle2 size={8} /> Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-red-500/10 text-red-600 text-[8px] font-bold uppercase rounded border border-red-500/20 flex items-center gap-1">
                            <XCircle size={8} /> Offline
                          </span>
                        )}
                        {torStatus?.controlInUse && (
                          <span className="px-2 py-0.5 bg-blue-500/10 text-blue-600 text-[8px] font-bold uppercase rounded border border-blue-500/20 flex items-center gap-1">
                            <Zap size={8} /> Control Connected
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Mode Selection */}
                    <div className="space-y-3">
                      <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                        Connection Mode
                      </span>
                      <TgSegmentedControl
                        size="sm"
                        className="w-full"
                        optionClassName="flex-1"
                        aria-label="TOR connection mode"
                        value={torMode}
                        onChange={setTorMode}
                        options={[
                          { value: "auto", label: "Automatic (Local)" },
                          { value: "custom", label: "Custom Cluster" },
                        ]}
                      />
                      <p className="text-[9px] opacity-40 italic serif">
                        {torMode === "auto"
                          ? "Uses the built-in TOR service on port 9050. Recommended for most users."
                          : "Connect to multiple external TOR instances for high-throughput rotation."}
                      </p>
                    </div>

                    {/* Proxy Pool (Only in Custom Mode) */}
                    <AnimatePresence>
                      {torMode === "custom" && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="space-y-3 overflow-hidden"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                              SOCKS5 Proxy Pool
                            </span>
                            <div className="flex gap-3">
                              {Object.keys(proxyTestResults).length > 0 && (
                                <TgButton
                                  type="button"
                                  variant="link"
                                  size="sm"
                                  onClick={clearProxyResults}
                                  className="opacity-40"
                                >
                                  Clear
                                </TgButton>
                              )}
                              <TgButton
                                type="button"
                                variant="link"
                                size="sm"
                                onClick={() =>
                                  handleTestAllProxies(torProxyUrls)
                                }
                                loading={isTestingAll}
                                loadingLabel="Test All"
                              >
                                <Activity size={10} />
                                Test All
                              </TgButton>
                            </div>
                          </div>
                          <TgTextarea
                            value={torProxyUrls}
                            onChange={(e) => setTorProxyUrls(e.target.value)}
                            placeholder="127.0.0.1:9050"
                            className="h-24 p-4 resize-none rounded-lg normal-case tracking-normal"
                          />

                          {/* TOR Proxy Test Results */}
                          {Object.keys(proxyTestResults).length > 0 &&
                            torProxyUrls
                              .split(/[\n,]+/)
                              .some((p) => proxyTestResults[p.trim()]) && (
                              <div className="space-y-1 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                                {torProxyUrls
                                  .split(/[\n,]+/)
                                  .map((p) => p.trim())
                                  .filter((p) => p && proxyTestResults[p])
                                  .map((url, idx) => {
                                    const res = proxyTestResults[url]
                                    // For TOR pool, we might need to prepend socks5h:// if it's just IP:PORT
                                    const _displayUrl = url.includes("://")
                                      ? url
                                      : `socks5h://${url}`
                                    return (
                                      <div
                                        key={idx}
                                        className="flex items-center justify-between text-[9px] bg-app-ink/5 p-2 border border-app-ink/5 rounded"
                                      >
                                        <span className="font-mono truncate max-w-[150px] opacity-60">
                                          {url}
                                        </span>
                                        <div className="flex items-center gap-2">
                                          {res.testing ? (
                                            <span className="flex items-center gap-1 opacity-40">
                                              <RotateCw
                                                size={8}
                                                className="animate-spin"
                                              />{" "}
                                              Testing...
                                            </span>
                                          ) : res.success ? (
                                            <>
                                              <span className="text-green-600 font-bold flex items-center gap-1">
                                                <CheckCircle2 size={8} />{" "}
                                                {res.latency}ms
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
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Strategy & Actions */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                          Rotation Strategy
                        </span>
                        <TgSegmentedControl
                          size="sm"
                          className={`w-full ${torMode === "auto" ? "opacity-30 grayscale" : ""}`}
                          optionClassName="flex-1"
                          aria-label="TOR rotation strategy"
                          value={torRotationStrategy}
                          onChange={setTorRotationStrategy}
                          options={[
                            {
                              value: "sequential",
                              label: "sequential",
                              disabled: torMode === "auto",
                            },
                            {
                              value: "random",
                              label: "random",
                              disabled: torMode === "auto",
                            },
                          ]}
                        />
                      </div>

                      <div className="space-y-3">
                        <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                          Quick Actions
                        </span>
                        <div className="flex gap-2">
                          <TgButton
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={restartTor}
                            className="flex-1"
                          >
                            <RefreshCw size={10} /> Restart
                          </TgButton>
                          <TgButton
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={checkTorIp}
                            disabled={!torStatus?.running}
                            loading={isCheckingIp}
                            loadingLabel="..."
                            className="flex-1"
                          >
                            <Globe size={10} />
                            Check IP
                          </TgButton>
                        </div>
                      </div>
                    </div>

                    {/* IP Display */}
                    <AnimatePresence>
                      {torIp && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="bg-app-ink/5 p-3 rounded-lg border border-app-ink/10 flex items-center justify-between"
                        >
                          <span className="text-[9px] uppercase font-bold opacity-40">
                            Current Exit IP
                          </span>
                          <span className="text-[10px] font-mono font-bold tracking-wider">
                            {torIp}
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Control Port Section */}
                    <div className="pt-4 border-t border-app-ink/5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 opacity-60">
                          <Activity size={14} />
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold uppercase tracking-tight">
                              IP Rotation Control
                            </span>
                            <span className="text-[8px] opacity-40 italic serif">
                              Requires ControlPort enabled in torrc
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setTorControlEnabled(!torControlEnabled)
                          }
                          className={`w-10 h-5 rounded-full transition-all relative ${torControlEnabled ? "bg-app-ink" : "bg-app-ink/10"}`}
                        >
                          <div
                            className={`absolute top-1 w-3 h-3 rounded-full bg-app-bg transition-all ${torControlEnabled ? "left-6" : "left-1"}`}
                          />
                        </button>
                      </div>

                      <AnimatePresence>
                        {torControlEnabled && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="space-y-4 overflow-hidden"
                          >
                            <div className="grid grid-cols-1 gap-4">
                              <div>
                                <TgFieldLabel>Control Port</TgFieldLabel>
                                <TgInput
                                  type="number"
                                  value={torControlPort}
                                  onChange={(e) =>
                                    setTorControlPort(
                                      parseInt(e.target.value, 10),
                                    )
                                  }
                                  className="rounded-lg normal-case tracking-normal"
                                />
                              </div>
                              <p className="text-[9px] opacity-50 italic serif">
                                Tor control password is configured on the server
                                via{" "}
                                <code className="font-mono">
                                  TOR_CONTROL_PASSWORD
                                </code>
                                .
                              </p>
                            </div>
                            <div className="flex items-center justify-between pt-2 bg-app-ink/5 p-3 rounded-lg border border-app-ink/10">
                              <p className="text-[9px] opacity-60 italic serif max-w-[200px]">
                                Request a fresh IP from TOR when rate limited.
                              </p>
                              <TgButton
                                type="button"
                                variant="primary"
                                size="sm"
                                onClick={changeTorIp}
                                disabled={!torStatus?.controlInUse}
                                loading={isChangingIp}
                                loadingLabel="Rotating..."
                              >
                                <Shield size={10} />
                                New Identity
                              </TgButton>
                            </div>

                            <div className="pt-4 border-t border-app-ink/5 space-y-4">
                              <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                  <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                                    Auto-Rotate IP
                                  </span>
                                  <span className="text-[8px] opacity-40 italic serif">
                                    Rotate identity automatically after X
                                    requests.
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setTorAutoRotate(!torAutoRotate)
                                  }
                                  className={`w-10 h-5 rounded-full transition-all relative ${torAutoRotate ? "bg-app-ink" : "bg-app-ink/10"}`}
                                >
                                  <div
                                    className={`absolute top-1 w-3 h-3 rounded-full bg-app-bg transition-all ${torAutoRotate ? "left-6" : "left-1"}`}
                                  />
                                </button>
                              </div>

                              {torAutoRotate && (
                                <motion.div
                                  initial={{ opacity: 0, y: -10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="flex items-center justify-between"
                                >
                                  <div className="flex flex-col">
                                    <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                                      Rotation Threshold
                                    </span>
                                    <span className="text-[8px] opacity-40 italic serif">
                                      Requests before rotation.
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <TgInput
                                      type="number"
                                      min={5}
                                      max={50}
                                      step={1}
                                      value={torRotationThreshold}
                                      onChange={(e) => {
                                        const val = Number.parseInt(
                                          e.target.value,
                                          10,
                                        )
                                        if (!Number.isNaN(val)) {
                                          setTorRotationThreshold(
                                            Math.min(50, Math.max(5, val)),
                                          )
                                        }
                                      }}
                                      className="w-16 p-2 text-right normal-case tracking-normal"
                                    />
                                  </div>
                                </motion.div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </TgSettingsSection>
        </>
      )}
    </div>
  )
}

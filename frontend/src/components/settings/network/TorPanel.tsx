import { Shield } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import { SettingAnchor } from "@/components/settings/SettingAnchor"
import { TgHelpText } from "@/components/ui/tg-input"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import { TgToggle } from "@/components/ui/tg-toggle"
import { useSettings } from "@/contexts/SettingsContext"
import { saveNetworkLog } from "@/lib/logs/write"
import type { NetworkLog } from "@/types"
import {
  TorControlSection,
  TorExitIp,
  TorModeField,
  TorNetworkStatus,
  TorProxyPool,
  TorQuickActions,
  TorStatusIndicator,
  TorStrategyField,
  TorUnavailableNotice,
} from "./TorPanelSections"
import { useProxyTesting } from "./useProxyTesting"

export const TorPanel: React.FC<{
  highlightId?: string | null
}> = ({ highlightId = null }) => {
  const {
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
  } = useSettings()

  const {
    proxyTestResults,
    isTestingAll,
    handleTestAllProxies,
    clearProxyResults,
  } = useProxyTesting()

  const [torStatus, setTorStatus] = useState<{
    running: boolean
    socksInUse: boolean
    controlInUse: boolean
    autoSpawned: boolean
  } | null>(null)
  const [torIp, setTorIp] = useState<string | null>(null)
  const [isCheckingIp, setIsCheckingIp] = useState(false)
  const [isChangingIp, setIsChangingIp] = useState(false)

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

  const running = Boolean(torStatus?.running)

  return (
    <TgSettingsSection icon={Shield} title="TOR Network">
      {!torAvailable && <TorUnavailableNotice />}
      <TorStatusIndicator running={running} />

      <div className="space-y-6">
        <SettingAnchor
          settingId="torEnabled"
          highlighted={highlightId === "torEnabled"}
          className="space-y-4"
        >
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
            Use TOR to anonymize requests and bypass geographic restrictions.
          </TgHelpText>
        </SettingAnchor>

        <AnimatePresence>
          {torEnabled && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-6 overflow-hidden pt-4"
            >
              <TorNetworkStatus
                running={running}
                controlConnected={Boolean(torStatus?.controlInUse)}
              />

              <TorModeField
                mode={torMode}
                onChange={setTorMode}
                highlightId={highlightId}
              />

              {/* Proxy Pool (Only in Custom Mode) */}
              <AnimatePresence>
                {torMode === "custom" && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-3 overflow-hidden"
                  >
                    <TorProxyPool
                      urls={torProxyUrls}
                      onChange={setTorProxyUrls}
                      results={proxyTestResults}
                      isTestingAll={isTestingAll}
                      onTestAll={() => handleTestAllProxies(torProxyUrls)}
                      onClear={clearProxyResults}
                      highlightId={highlightId}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <TorStrategyField
                  mode={torMode}
                  value={torRotationStrategy}
                  onChange={setTorRotationStrategy}
                  highlightId={highlightId}
                />
                <TorQuickActions
                  onRestart={restartTor}
                  onCheckIp={checkTorIp}
                  running={running}
                  isCheckingIp={isCheckingIp}
                />
              </div>

              <TorExitIp ip={torIp} />

              <TorControlSection
                highlightId={highlightId}
                controlEnabled={torControlEnabled}
                onControlEnabledChange={setTorControlEnabled}
                controlPort={torControlPort}
                onControlPortChange={setTorControlPort}
                controlConnected={Boolean(torStatus?.controlInUse)}
                isChangingIp={isChangingIp}
                onNewIdentity={changeTorIp}
                autoRotate={torAutoRotate}
                onAutoRotateChange={setTorAutoRotate}
                rotationThreshold={torRotationThreshold}
                onRotationThresholdChange={setTorRotationThreshold}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </TgSettingsSection>
  )
}

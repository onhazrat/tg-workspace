import {
  Activity,
  CheckCircle2,
  Globe,
  RefreshCw,
  Shield,
  XCircle,
  Zap,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { SettingAnchor } from "@/components/settings/SettingAnchor"
import { TgButton } from "@/components/ui/tg-button"
import { TgFieldLabel, TgInput, TgTextarea } from "@/components/ui/tg-input"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { ProxyTestResults } from "./ProxyTestResults"
import type { ProxyTestResult } from "./useProxyTesting"

export type TorMode = "auto" | "custom"
export type TorRotationStrategy = "sequential" | "random"

const LABEL = "text-[10px] font-bold uppercase tracking-tight opacity-60"

/**
 * The rotation threshold a typed value sets: clamped to 5..50, or null for
 * input that is not a number yet (an empty field mid-edit), which leaves the
 * setting alone.
 */
export function clampRotationThreshold(raw: string): number | null {
  const val = Number.parseInt(raw, 10)
  if (Number.isNaN(val)) return null
  return Math.min(50, Math.max(5, val))
}

/** The pill switch the control-port rows use (not `TgToggle`, as before). */
function PillSwitch({
  checked,
  onClick,
  testId,
}: {
  checked: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`w-10 h-5 rounded-full transition-all relative ${checked ? "bg-app-ink" : "bg-app-ink/10"}`}
    >
      <div
        className={`absolute top-1 w-3 h-3 rounded-full bg-app-bg transition-all ${checked ? "left-6" : "left-1"}`}
      />
    </button>
  )
}

export function TorUnavailableNotice() {
  return (
    <p className="text-[10px] text-amber-700/80 italic serif mb-4">
      Tor is disabled on this server. Set{" "}
      <code className="font-mono">TOR_ENABLED=true</code> and configure the Tor
      sidecar to enable.
    </p>
  )
}

/** The dot and word under the section title. */
export function TorStatusIndicator({ running }: { running: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      <div
        className={`w-1.5 h-1.5 rounded-full ${running ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-red-500"}`}
      />
      <span className="text-[9px] font-bold uppercase tracking-widest opacity-60">
        {running ? "Active" : "Inactive"}
      </span>
    </div>
  )
}

/** The status dashboard: running or offline, and whether control is connected. */
export function TorNetworkStatus({
  running,
  controlConnected,
}: {
  running: boolean
  controlConnected: boolean
}) {
  return (
    <div className="flex items-center justify-between bg-app-ink/5 p-4 rounded-xl border border-app-ink/10">
      <div className="flex items-center gap-3">
        <div
          className={`w-2 h-2 rounded-full ${running ? "bg-green-500 animate-pulse" : "bg-red-500"}`}
        />
        <span className="text-[10px] font-bold uppercase tracking-widest">
          Network Status
        </span>
      </div>
      <div className="flex gap-2">
        {running ? (
          <span className="px-2 py-0.5 bg-green-500/10 text-green-600 text-[8px] font-bold uppercase rounded border border-green-500/20 flex items-center gap-1">
            <CheckCircle2 size={8} /> Active
          </span>
        ) : (
          <span className="px-2 py-0.5 bg-red-500/10 text-red-600 text-[8px] font-bold uppercase rounded border border-red-500/20 flex items-center gap-1">
            <XCircle size={8} /> Offline
          </span>
        )}
        {controlConnected && (
          <span className="px-2 py-0.5 bg-blue-500/10 text-blue-600 text-[8px] font-bold uppercase rounded border border-blue-500/20 flex items-center gap-1">
            <Zap size={8} /> Control Connected
          </span>
        )}
      </div>
    </div>
  )
}

export function TorModeField({
  mode,
  onChange,
  highlightId,
}: {
  mode: TorMode
  onChange: (mode: TorMode) => void
  highlightId: string | null
}) {
  return (
    <SettingAnchor
      settingId="torMode"
      highlighted={highlightId === "torMode"}
      className="space-y-3"
    >
      <span className={LABEL}>Connection Mode</span>
      <TgSegmentedControl
        size="sm"
        className="w-full"
        optionClassName="flex-1"
        aria-label="TOR connection mode"
        value={mode}
        onChange={onChange}
        options={[
          { value: "auto", label: "Automatic (Local)" },
          { value: "custom", label: "Custom Cluster" },
        ]}
      />
      <p className="text-[9px] opacity-40 italic serif">
        {mode === "auto"
          ? "Uses the built-in TOR service on port 9050. Recommended for most users."
          : "Connect to multiple external TOR instances for high-throughput rotation."}
      </p>
    </SettingAnchor>
  )
}

/** The custom-cluster SOCKS5 pool, its test buttons and results. */
export function TorProxyPool({
  urls,
  onChange,
  results,
  isTestingAll,
  onTestAll,
  onClear,
  highlightId,
}: {
  urls: string
  onChange: (urls: string) => void
  results: Record<string, ProxyTestResult>
  isTestingAll: boolean
  onTestAll: () => void
  onClear: () => void
  highlightId: string | null
}) {
  return (
    <>
      <SettingAnchor
        settingId="torProxyUrls"
        highlighted={highlightId === "torProxyUrls"}
        className="space-y-3"
      >
        <div className="flex items-center justify-between">
          <span className={LABEL}>SOCKS5 Proxy Pool</span>
          <div className="flex gap-3">
            {Object.keys(results).length > 0 && (
              <TgButton
                type="button"
                variant="link"
                size="sm"
                onClick={onClear}
                className="opacity-40"
              >
                Clear
              </TgButton>
            )}
            <TgButton
              type="button"
              variant="link"
              size="sm"
              onClick={onTestAll}
              loading={isTestingAll}
              loadingLabel="Test All"
            >
              <Activity size={10} />
              Test All
            </TgButton>
          </div>
        </div>
        <TgTextarea
          value={urls}
          onChange={(e) => onChange(e.target.value)}
          placeholder="127.0.0.1:9050"
          className="h-24 p-4 resize-none rounded-lg normal-case tracking-normal"
        />
      </SettingAnchor>
      <ProxyTestResults list={urls} results={results} />
    </>
  )
}

/** Rotation strategy; it only applies to a custom cluster, so auto greys it out. */
export function TorStrategyField({
  mode,
  value,
  onChange,
  highlightId,
}: {
  mode: TorMode
  value: TorRotationStrategy
  onChange: (value: TorRotationStrategy) => void
  highlightId: string | null
}) {
  const auto = mode === "auto"
  return (
    <SettingAnchor
      settingId="torRotationStrategy"
      highlighted={highlightId === "torRotationStrategy"}
      className="space-y-3"
    >
      <span className={LABEL}>Rotation Strategy</span>
      <TgSegmentedControl
        size="sm"
        className={`w-full ${auto ? "opacity-30 grayscale" : ""}`}
        optionClassName="flex-1"
        aria-label="TOR rotation strategy"
        value={value}
        onChange={onChange}
        options={[
          { value: "sequential", label: "sequential", disabled: auto },
          { value: "random", label: "random", disabled: auto },
        ]}
      />
    </SettingAnchor>
  )
}

export function TorQuickActions({
  onRestart,
  onCheckIp,
  running,
  isCheckingIp,
}: {
  onRestart: () => void
  onCheckIp: () => void
  running: boolean
  isCheckingIp: boolean
}) {
  return (
    <div className="space-y-3">
      <span className={LABEL}>Quick Actions</span>
      <div className="flex gap-2">
        <TgButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRestart}
          className="flex-1"
        >
          <RefreshCw size={10} /> Restart
        </TgButton>
        <TgButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={onCheckIp}
          disabled={!running}
          loading={isCheckingIp}
          loadingLabel="..."
          className="flex-1"
        >
          <Globe size={10} />
          Check IP
        </TgButton>
      </div>
    </div>
  )
}

/** The exit IP from the last check, once there has been one. */
export function TorExitIp({ ip }: { ip: string | null }) {
  return (
    <AnimatePresence>
      {ip && (
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
            {ip}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * The control-port block: the switch, and while it is on the port, New
 * Identity (only once the control port is connected) and auto-rotation.
 */
export function TorControlSection({
  highlightId,
  controlEnabled,
  onControlEnabledChange,
  controlPort,
  onControlPortChange,
  controlConnected,
  isChangingIp,
  onNewIdentity,
  autoRotate,
  onAutoRotateChange,
  rotationThreshold,
  onRotationThresholdChange,
}: {
  highlightId: string | null
  controlEnabled: boolean
  onControlEnabledChange: (enabled: boolean) => void
  controlPort: number
  onControlPortChange: (port: number) => void
  controlConnected: boolean
  isChangingIp: boolean
  onNewIdentity: () => void
  autoRotate: boolean
  onAutoRotateChange: (enabled: boolean) => void
  rotationThreshold: number
  onRotationThresholdChange: (threshold: number) => void
}) {
  return (
    <div className="pt-4 border-t border-app-ink/5 space-y-4">
      <SettingAnchor
        settingId="torControlEnabled"
        highlighted={highlightId === "torControlEnabled"}
        className="flex items-center justify-between"
      >
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
        <PillSwitch
          checked={controlEnabled}
          onClick={() => onControlEnabledChange(!controlEnabled)}
          testId="tor-control-switch"
        />
      </SettingAnchor>

      <AnimatePresence>
        {controlEnabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-4 overflow-hidden"
          >
            <div className="grid grid-cols-1 gap-4">
              <SettingAnchor
                settingId="torControlPort"
                highlighted={highlightId === "torControlPort"}
              >
                <TgFieldLabel>Control Port</TgFieldLabel>
                <TgInput
                  type="number"
                  value={controlPort}
                  onChange={(e) =>
                    onControlPortChange(parseInt(e.target.value, 10))
                  }
                  className="rounded-lg normal-case tracking-normal"
                />
              </SettingAnchor>
              <p className="text-[9px] opacity-50 italic serif">
                Tor control password is configured on the server via{" "}
                <code className="font-mono">TOR_CONTROL_PASSWORD</code>.
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
                onClick={onNewIdentity}
                disabled={!controlConnected}
                loading={isChangingIp}
                loadingLabel="Rotating..."
              >
                <Shield size={10} />
                New Identity
              </TgButton>
            </div>

            <div className="pt-4 border-t border-app-ink/5 space-y-4">
              <SettingAnchor
                settingId="torAutoRotate"
                highlighted={highlightId === "torAutoRotate"}
                className="flex items-center justify-between"
              >
                <div className="flex flex-col">
                  <span className={LABEL}>Auto-Rotate IP</span>
                  <span className="text-[8px] opacity-40 italic serif">
                    Rotate identity automatically after X requests.
                  </span>
                </div>
                <PillSwitch
                  checked={autoRotate}
                  onClick={() => onAutoRotateChange(!autoRotate)}
                  testId="tor-auto-rotate-switch"
                />
              </SettingAnchor>

              {autoRotate && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <SettingAnchor
                    settingId="torRotationThreshold"
                    highlighted={highlightId === "torRotationThreshold"}
                    className="flex items-center justify-between"
                  >
                    <div className="flex flex-col">
                      <span className={LABEL}>Rotation Threshold</span>
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
                        value={rotationThreshold}
                        data-testid="tor-rotation-threshold"
                        onChange={(e) => {
                          const next = clampRotationThreshold(e.target.value)
                          if (next !== null) onRotationThresholdChange(next)
                        }}
                        className="w-16 p-2 text-right normal-case tracking-normal"
                      />
                    </div>
                  </SettingAnchor>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * The Network topic's panels (SET-03): the proxy pool, which an Operator runs
 * from a table, and Tor's actions. Whether proxies and Tor are on, the slots
 * per proxy and every Tor field are Setting rows (SET-02); what is here is
 * what a row cannot hold: a list, a map, test results and live health.
 *
 * Credentials stay masked until revealed, and the masked text is never an
 * input value, so nothing can write `***` back into the list.
 */
import { useQuery } from "@tanstack/react-query"
import { Eye, EyeOff, RotateCw } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import type { BadProxy } from "@/client"
import { pillClass } from "@/components/PostFilterParts"
import { TgButton } from "@/components/ui/tg-button"
import { useSettings } from "@/contexts/SettingsContext"
import { type ProxyTestResult, useProxyTesting } from "@/hooks/useProxyTesting"
import { saveNetworkLog } from "@/lib/logs/write"
import { maskProxyUrl } from "@/lib/network/maskProxyUrl"
import { normalizeProxyUrl } from "@/lib/settings/proxy-concurrency"
import { parseProxyList } from "@/lib/syncSettings"
import {
  ConfirmButton,
  cellClass,
  FormPill,
  ListTable,
  Note,
  PanelField,
  rowClass,
  Status,
} from "./kit"

/** Seconds left on a cooling proxy, as `m:ss`. */
const formatCooldown = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`

const slotRefusal = (draft: string): string | null => {
  if (draft.trim() === "") return null
  const n = Number(draft)
  return Number.isInteger(n) && n >= 1 && n <= 20 ? null : "1 to 20"
}

function TestCell({ result }: { result: ProxyTestResult | undefined }) {
  if (!result) return <span className="text-app-ink/40">—</span>
  if (result.testing) return <Status tone="off">Testing…</Status>
  if (result.success)
    return (
      <Status tone="ok">
        {result.latency} ms · {result.ip}
      </Status>
    )
  return (
    <span title={result.error}>
      <Status tone="bad">Failed</Status>
    </span>
  )
}

function AddProxies({ onAdd }: { onAdd: (urls: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [paste, setPaste] = useState("")
  const urls = parseProxyList(paste)
  return (
    <FormPill
      label="Add proxies"
      heading="One proxy URL per line"
      width="w-96"
      open={open}
      onOpenChange={setOpen}
    >
      <textarea
        aria-label="Proxy URLs"
        rows={4}
        value={paste}
        placeholder="socks5h://user:pass@host:port"
        onChange={(e) => setPaste(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        className="w-full resize-y rounded-lg border border-app-ink/15 bg-app-muted p-2 font-mono text-[11px] outline-none focus:border-app-ink/40"
      />
      <TgButton
        size="sm"
        disabled={!urls.length}
        onClick={() => {
          onAdd(urls)
          setPaste("")
          setOpen(false)
        }}
      >
        Add {urls.length}
      </TgButton>
    </FormPill>
  )
}

export function ProxiesView({
  proxies,
  defaultSlots,
  overrides,
  results,
  testing,
  cooling,
  envFallback,
  onAdd,
  onRemove,
  onSlots,
  onTestAll,
}: {
  proxies: string[]
  defaultSlots: number
  /** Slots per proxy, keyed by the normalised URL. */
  overrides: Record<string, number>
  results: Record<string, ProxyTestResult>
  testing: boolean
  /** Proxies the server is avoiding after repeated failures. */
  cooling: BadProxy[]
  /** Whether an empty list falls back to `DEFAULT_PROXY_URLS`. */
  envFallback: boolean
  onAdd: (urls: string[]) => void
  onRemove: (url: string) => Promise<unknown>
  onSlots: (url: string, slots: number | null) => void
  onTestAll: () => void
}) {
  const [reveal, setReveal] = useState(false)
  const show = (url: string) => (reveal ? url : maskProxyUrl(url))
  const coolingFor = new Map(
    cooling.map((b) => [normalizeProxyUrl(b.url), b.cooldownRemaining]),
  )
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <AddProxies onAdd={onAdd} />
        <button
          type="button"
          className={pillClass(false)}
          disabled={!proxies.length || testing}
          onClick={onTestAll}
        >
          <RotateCw size={12} className={testing ? "animate-spin" : ""} />
          Test all
        </button>
        <button
          type="button"
          aria-pressed={reveal}
          className={pillClass(reveal)}
          onClick={() => setReveal(!reveal)}
        >
          {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
          {reveal ? "Hide credentials" : "Show credentials"}
        </button>
      </div>
      <ListTable
        testId="proxy-pool"
        columns={[
          { label: "Proxy" },
          { label: "Slots", className: "text-right" },
          { label: "Test" },
          { label: "Health" },
          { label: "" },
        ]}
        isEmpty={!proxies.length}
        empty={
          envFallback
            ? "No proxies. Syncs use DEFAULT_PROXY_URLS from .env."
            : "No proxies. Syncs go out directly."
        }
      >
        {proxies.map((url) => {
          const cooldown = coolingFor.get(normalizeProxyUrl(url))
          return (
            <tr key={url} className={rowClass}>
              <td
                className={`${cellClass} max-w-72 truncate font-mono text-[11px]`}
              >
                {show(url)}
              </td>
              <td className={`${cellClass} text-right`}>
                <PanelField
                  label={`Slots for ${maskProxyUrl(url)}`}
                  className="w-16 text-right tabular-nums"
                  value={String(overrides[normalizeProxyUrl(url)] ?? "")}
                  placeholder={String(defaultSlots)}
                  invalid={slotRefusal}
                  onCommit={(v) => onSlots(url, v.trim() ? Number(v) : null)}
                />
              </td>
              <td className={cellClass}>
                <TestCell result={results[url]} />
              </td>
              <td className={cellClass}>
                {cooldown ? (
                  <Status tone="warn">
                    Cooling down {formatCooldown(cooldown)}
                  </Status>
                ) : (
                  <Status tone="ok">Healthy</Status>
                )}
              </td>
              <td className={`${cellClass} text-right`}>
                <ConfirmButton
                  label={`Remove ${maskProxyUrl(url)}`}
                  title="Remove this proxy?"
                  description={maskProxyUrl(url)}
                  confirmLabel="Remove"
                  onConfirm={() => onRemove(url)}
                />
              </td>
            </tr>
          )
        })}
      </ListTable>
      <Note>
        A blank slot count uses the default ({defaultSlots}). A proxy that keeps
        failing cools down before it is used again.
      </Note>
    </div>
  )
}

export function Proxies() {
  const s = useSettings()
  const { proxyTestResults, isTestingAll, handleTestAllProxies } =
    useProxyTesting()
  const { data: health } = useQuery({
    queryKey: ["proxyHealth"],
    queryFn: () => api.proxyHealth(),
    refetchInterval: 10_000,
  })
  const proxies = parseProxyList(s.defaultProxyUrls)
  return (
    <ProxiesView
      proxies={proxies}
      defaultSlots={s.proxyDefaultConcurrency}
      overrides={s.proxyConcurrencyOverrides}
      results={proxyTestResults}
      testing={isTestingAll}
      cooling={health?.badProxies ?? []}
      envFallback={s.envFallbackConfigured}
      onAdd={(urls) =>
        s.setDefaultProxyUrls([...new Set([...proxies, ...urls])].join("\n"))
      }
      onRemove={async (url) =>
        s.setDefaultProxyUrls(proxies.filter((p) => p !== url).join("\n"))
      }
      onSlots={(url, slots) => {
        const next = { ...s.proxyConcurrencyOverrides }
        if (slots === null) delete next[normalizeProxyUrl(url)]
        else next[normalizeProxyUrl(url)] = slots
        s.setProxyConcurrencyOverrides(next)
      }}
      onTestAll={() => void handleTestAllProxies(s.defaultProxyUrls)}
    />
  )
}

export function TorActionsView({
  running,
  controlConnected,
  ip,
  testing,
  rotating,
  onTest,
  onRotate,
  onRestart,
}: {
  running: boolean
  controlConnected: boolean
  /** The exit IP from the last Test, once there has been one. */
  ip: string | null
  testing: boolean
  rotating: boolean
  onTest: () => void
  onRotate: () => void
  onRestart: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Status tone={running ? "ok" : "bad"}>
          {running ? "Running" : "Not running"}
        </Status>
        <Status tone={controlConnected ? "ok" : "off"}>
          {controlConnected
            ? "Control port connected"
            : "Control port not connected"}
        </Status>
        {ip && (
          <span className="text-app-ink/60">
            Exit IP <span className="font-mono text-app-ink">{ip}</span>
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <TgButton
          size="sm"
          variant="secondary"
          disabled={!running}
          loading={testing}
          onClick={onTest}
        >
          Test
        </TgButton>
        <TgButton
          size="sm"
          variant="secondary"
          disabled={!controlConnected}
          loading={rotating}
          onClick={onRotate}
        >
          Rotate
        </TgButton>
        <TgButton size="sm" variant="secondary" onClick={onRestart}>
          Restart
        </TgButton>
      </div>
      <Note>
        Test asks Tor for its exit IP. Rotate asks the control port for a new
        circuit, so the IP changes shortly after.
      </Note>
    </div>
  )
}

/** Runs one Tor call and files the network log it always filed. */
async function logged<T>(
  url: string,
  method: "GET" | "POST",
  source: string,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now()
  let status: "success" | "failed" = "failed"
  let error: string | undefined
  let telemetry: unknown = null
  try {
    const result = await run()
    status = "success"
    telemetry = result
    return result
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    await saveNetworkLog({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      url,
      method,
      status,
      duration: Date.now() - started,
      error,
      proxyUsed: "socks5h://127.0.0.1:9050",
      telemetry,
      source,
    })
  }
}

export function TorActions() {
  const { torControlPort } = useSettings()
  const { data: status } = useQuery({
    queryKey: ["torStatus"],
    queryFn: () => api.torStatus(),
    refetchInterval: 10_000,
  })
  const [ip, setIp] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [rotating, setRotating] = useState(false)

  const test = async () => {
    setTesting(true)
    try {
      const data = await logged(
        "/api/v1/network/tor-ip",
        "GET",
        "Settings.torTest",
        () => api.torIp(),
      )
      setIp(data.ip)
      toast.success(`Tor exit IP: ${data.ip}`)
    } catch {
      toast.error("Network error while checking the Tor IP")
    } finally {
      setTesting(false)
    }
  }
  const rotate = async () => {
    setRotating(true)
    try {
      await logged(
        "/api/v1/network/tor-new-identity",
        "POST",
        "Settings.torRotate",
        () => api.torNewIdentity(torControlPort),
      )
      toast.success("New circuit requested. The IP changes shortly.")
      // A new circuit takes a few seconds to change the IP; Test again then.
      setTimeout(() => void test(), 3000)
    } catch {
      toast.error("Network error while requesting a new circuit")
    } finally {
      setRotating(false)
    }
  }
  const restart = async () => {
    try {
      await api.torRestart()
      toast.success("Tor restart initiated")
    } catch {
      toast.error("Network error while restarting Tor")
    }
  }
  return (
    <TorActionsView
      running={Boolean(status?.running)}
      controlConnected={Boolean(status?.controlInUse)}
      ip={ip}
      testing={testing}
      rotating={rotating}
      onTest={() => void test()}
      onRotate={() => void rotate()}
      onRestart={() => void restart()}
    />
  )
}

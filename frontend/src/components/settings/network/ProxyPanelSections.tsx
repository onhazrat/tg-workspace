import { Activity, Eye, EyeOff, Shield } from "lucide-react"
import type { BadProxy } from "@/client"
import { SettingAnchor } from "@/components/settings/SettingAnchor"
import { TgButton } from "@/components/ui/tg-button"
import { TgHelpText, TgInput, TgTextarea } from "@/components/ui/tg-input"
import { hasProxyCredentials, maskProxyList } from "@/lib/network/maskProxyUrl"
import {
  effectiveProxyCapacity,
  normalizeProxyUrl,
  slotsForProxy,
} from "@/lib/settings/proxy-concurrency"

const LABEL = "text-[10px] font-bold uppercase tracking-tight"

/** A typed slot count, clamped to 1..20; anything unparsable is 1. */
export const clampSlots = (raw: string): number =>
  Math.max(1, Math.min(20, parseInt(raw, 10) || 1))

/** Seconds left on a blacklisted proxy's cooldown, as `m:ss`. */
export const formatCooldown = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`

/**
 * The proxy list and its actions.
 *
 * Credentials are hidden until explicitly revealed. While hidden the textarea
 * is read-only and shows a masked projection, so there is no code path that
 * can write `***` back into the setting: the masked text is never an input
 * value. Leaving the field hides them again.
 */
export function ProxyListEditor({
  urls,
  onChange,
  revealed,
  onRevealedChange,
  hasResults,
  onClearResults,
  isTestingAll,
  onTestAll,
  highlightId,
}: {
  urls: string
  onChange: (urls: string) => void
  revealed: boolean
  onRevealedChange: (revealed: boolean) => void
  hasResults: boolean
  onClearResults: () => void
  isTestingAll: boolean
  onTestAll: () => void
  highlightId: string | null
}) {
  const hasCredentials = hasProxyCredentials(urls)
  const hidden = hasCredentials && !revealed
  return (
    <SettingAnchor
      settingId="defaultProxyUrls"
      highlighted={highlightId === "defaultProxyUrls"}
      className="space-y-4"
    >
      <div className="flex items-center justify-between opacity-60">
        <span className={LABEL}>Proxy List (HTTP/SOCKS5)</span>
        <div className="flex gap-3">
          {hasCredentials && (
            <TgButton
              type="button"
              variant="link"
              size="sm"
              onClick={() => onRevealedChange(!revealed)}
              aria-label={
                revealed
                  ? "Hide proxy credentials"
                  : "Reveal proxy credentials to edit"
              }
            >
              {revealed ? <EyeOff size={10} /> : <Eye size={10} />}
              {revealed ? "Hide" : "Reveal"}
            </TgButton>
          )}
          {hasResults && (
            <TgButton
              type="button"
              variant="link"
              size="sm"
              onClick={onClearResults}
              className="opacity-60"
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
        value={hidden ? maskProxyList(urls) : urls}
        onChange={(e) => onChange(e.target.value)}
        // Read-only while masked: the displayed value is a projection,
        // not the setting, so editing it would persist `***`.
        readOnly={hidden}
        onBlur={() => onRevealedChange(false)}
        placeholder="http://user:pass@host:port or socks5h://host:port (one per line)"
        className={`h-32 resize-none normal-case tracking-normal ${
          hidden ? "cursor-not-allowed" : ""
        }`}
      />
      {hidden && (
        <TgHelpText>
          Credentials are hidden. Choose <strong>Reveal</strong> to edit the
          list.
        </TgHelpText>
      )}
    </SettingAnchor>
  )
}

/** Default slots per proxy, per-proxy overrides, and the capacity they add up to. */
export function ProxySlots({
  proxies,
  defaultSlots,
  onDefaultSlotsChange,
  overrides,
  onOverridesChange,
  display,
  highlightId,
}: {
  proxies: string[]
  defaultSlots: number
  onDefaultSlotsChange: (slots: number) => void
  overrides: Record<string, number>
  onOverridesChange: (overrides: Record<string, number>) => void
  display: (url: string) => string
  highlightId: string | null
}) {
  const capacity =
    effectiveProxyCapacity(proxies, overrides, defaultSlots) || defaultSlots
  return (
    <div className="space-y-3 pt-2 border-t border-app-ink/5">
      <SettingAnchor
        settingId="proxyDefaultConcurrency"
        highlighted={highlightId === "proxyDefaultConcurrency"}
        className="flex items-center justify-between gap-4"
      >
        <span className={`${LABEL} opacity-60`}>Default slots per proxy</span>
        <TgInput
          type="number"
          min={1}
          max={20}
          value={defaultSlots}
          onChange={(e) => onDefaultSlotsChange(clampSlots(e.target.value))}
          className="w-16 p-2 text-right normal-case tracking-normal"
        />
      </SettingAnchor>
      {proxies.length > 0 && (
        <SettingAnchor
          settingId="proxyConcurrencyOverrides"
          highlighted={highlightId === "proxyConcurrencyOverrides"}
          className="space-y-2"
        >
          <span className={`${LABEL} opacity-60`}>Per-proxy overrides</span>
          <div className="space-y-1">
            {proxies.map((url) => (
              <div
                key={url}
                className="flex items-center justify-between gap-3 text-[9px] bg-app-ink/5 p-2 border border-app-ink/5 rounded"
              >
                <span className="font-mono truncate flex-1 opacity-60">
                  {display(url)}
                </span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={slotsForProxy(url, overrides, defaultSlots)}
                  onChange={(e) =>
                    onOverridesChange({
                      ...overrides,
                      [normalizeProxyUrl(url)]: clampSlots(e.target.value),
                    })
                  }
                  className="w-14 bg-white/50 border border-app-ink/10 p-1 text-[9px] font-mono text-right focus:outline-none"
                />
              </div>
            ))}
          </div>
        </SettingAnchor>
      )}
      <p
        className="text-[8px] opacity-40 italic serif"
        data-testid="proxy-capacity"
      >
        Effective parallel HTTP capacity ≈ {capacity} slot
        {capacity === 1 ? "" : "s"}. This is how many channels are scraped at
        once — there is no separate ceiling to keep below it any more.
      </p>
    </div>
  )
}

/** Proxies the server is avoiding after repeated failures, or nothing. */
export function BlacklistedProxies({ proxies }: { proxies: BadProxy[] }) {
  if (proxies.length === 0) return null
  return (
    <div className="space-y-3 pt-2 border-t border-app-ink/5">
      <div className="flex items-center justify-between">
        <span className={`${LABEL} text-red-600 flex items-center gap-2`}>
          <Shield size={10} /> Blacklisted Proxies
        </span>
        <span className="text-[8px] opacity-40 uppercase tracking-widest">
          Auto-Cooldown
        </span>
      </div>
      <div className="space-y-1">
        {proxies.map((proxy, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between text-[9px] bg-red-500/5 p-2 border border-red-500/10 rounded"
            data-testid="blacklisted-proxy"
          >
            <span className="font-mono truncate max-w-[180px] opacity-60">
              {proxy.url}
            </span>
            <span className="text-red-600 font-bold tabular-nums">
              {formatCooldown(proxy.cooldownRemaining)}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[8px] opacity-30 italic serif">
        Proxies are temporarily avoided after repeated network failures.
      </p>
    </div>
  )
}

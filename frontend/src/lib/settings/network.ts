import { parseProxyList } from "@/lib/syncSettings"

/** Server-backed network settings — never persisted to localStorage. */
export interface NetworkSettings {
  proxyEnabled: boolean
  defaultProxyUrls: string
  proxyDefaultConcurrency: number
  proxyConcurrencyOverrides: Record<string, number>
  /** Read-only: reported by the server. */
  envFallbackConfigured: boolean
  /** Read-only: reported by the server. */
  torAvailable: boolean
  torEnabled: boolean
  torMode: "auto" | "custom"
  torProxyUrls: string
  torRotationStrategy: "sequential" | "random"
  torControlEnabled: boolean
  torControlPort: number
  torAutoRotate: boolean
  torRotationThreshold: number
}

export const NETWORK_SETTINGS_DEFAULTS: NetworkSettings = {
  proxyEnabled: false,
  defaultProxyUrls: "",
  proxyDefaultConcurrency: 1,
  proxyConcurrencyOverrides: {},
  envFallbackConfigured: false,
  torAvailable: false,
  torEnabled: false,
  torMode: "auto",
  torProxyUrls: "socks5h://127.0.0.1:9050",
  torRotationStrategy: "sequential",
  torControlEnabled: false,
  torControlPort: 9051,
  torAutoRotate: false,
  torRotationThreshold: 10,
}

export type WritableNetworkKey = Exclude<
  keyof NetworkSettings,
  "envFallbackConfigured" | "torAvailable"
>

export type NetworkSettingSetters = {
  [K in WritableNetworkKey as `set${Capitalize<K>}`]: (
    value: NetworkSettings[K],
  ) => void
}

const isBoolean = (v: unknown) => typeof v === "boolean"
const isNumber = (v: unknown) => typeof v === "number"
const isString = (v: unknown) => typeof v === "string"
const isObject = (v: unknown) => v !== null && typeof v === "object"
const oneOf =
  (...allowed: string[]) =>
  (v: unknown) =>
    allowed.includes(v as string)

/**
 * What each field accepts from a server payload. Keyed by every field of
 * `NetworkSettings`, so adding a field without saying how to read it is a
 * compile error rather than a setting that never loads.
 */
const ACCEPTS: Record<keyof NetworkSettings, (v: unknown) => boolean> = {
  proxyEnabled: isBoolean,
  defaultProxyUrls: isString,
  proxyDefaultConcurrency: isNumber,
  proxyConcurrencyOverrides: isObject,
  envFallbackConfigured: isBoolean,
  torAvailable: isBoolean,
  torEnabled: isBoolean,
  torMode: oneOf("auto", "custom"),
  torProxyUrls: isString,
  torRotationStrategy: oneOf("sequential", "random"),
  torControlEnabled: isBoolean,
  torControlPort: isNumber,
  torAutoRotate: isBoolean,
  torRotationThreshold: isNumber,
}

/** Pure server-payload -> state merge; absent or malformed fields are ignored. */
export function mergeNetworkSettings(
  base: NetworkSettings,
  value: Record<string, unknown>,
): NetworkSettings {
  const next: Record<string, unknown> = { ...base }
  for (const [key, accepts] of Object.entries(ACCEPTS)) {
    if (accepts(value[key])) next[key] = value[key]
  }
  // The server stores the list; `defaultProxyUrls` is the textarea's joined
  // form, and the list wins when both are present.
  if (Array.isArray(value.proxyUrls)) {
    next.defaultProxyUrls = (value.proxyUrls as string[]).join("\n")
  }
  return next as unknown as NetworkSettings
}

/** Full payload for saveNetworkSettings (debounced save path). */
export function buildNetworkSavePayload(
  state: NetworkSettings,
): Record<string, unknown> {
  return {
    proxyEnabled: state.proxyEnabled,
    proxyUrls: parseProxyList(state.defaultProxyUrls),
    proxyDefaultConcurrency: state.proxyDefaultConcurrency,
    proxyConcurrencyOverrides: state.proxyConcurrencyOverrides,
    torEnabled: state.torEnabled,
    torMode: state.torMode,
    torProxyUrls: state.torProxyUrls,
    torRotationStrategy: state.torRotationStrategy,
    torControlEnabled: state.torControlEnabled,
    torControlPort: state.torControlPort,
    torAutoRotate: state.torAutoRotate,
    torRotationThreshold: state.torRotationThreshold,
  }
}

/**
 * `proxyEnabled`/`torEnabled` an older build kept in browser storage, for the
 * ones the server row does not have yet. Empty means nothing to write back.
 */
export function legacyNetworkFlags(
  server: Record<string, unknown>,
  storage: { getItem(key: string): string | null },
): Record<string, unknown> {
  const legacy: Record<string, unknown> = {}
  for (const key of ["proxyEnabled", "torEnabled"]) {
    const stored = storage.getItem(key)
    if (stored !== null && server[key] === undefined) {
      legacy[key] = stored === "true"
    }
  }
  return legacy
}

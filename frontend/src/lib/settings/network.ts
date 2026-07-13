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

/** Pure server-payload -> state merge; absent or malformed fields are ignored. */
export function mergeNetworkSettings(
  base: NetworkSettings,
  value: Record<string, unknown>,
): NetworkSettings {
  const next = { ...base }
  if (Array.isArray(value.proxyUrls)) {
    next.defaultProxyUrls = (value.proxyUrls as string[]).join("\n")
  } else if (typeof value.defaultProxyUrls === "string") {
    next.defaultProxyUrls = value.defaultProxyUrls
  }
  if (typeof value.envFallbackConfigured === "boolean") {
    next.envFallbackConfigured = value.envFallbackConfigured
  }
  if (typeof value.torAvailable === "boolean") {
    next.torAvailable = value.torAvailable
  }
  if (typeof value.proxyEnabled === "boolean") {
    next.proxyEnabled = value.proxyEnabled
  }
  if (typeof value.proxyDefaultConcurrency === "number") {
    next.proxyDefaultConcurrency = value.proxyDefaultConcurrency
  }
  if (
    value.proxyConcurrencyOverrides &&
    typeof value.proxyConcurrencyOverrides === "object"
  ) {
    next.proxyConcurrencyOverrides = value.proxyConcurrencyOverrides as Record<
      string,
      number
    >
  }
  if (typeof value.torEnabled === "boolean") {
    next.torEnabled = value.torEnabled
  }
  if (value.torMode === "auto" || value.torMode === "custom") {
    next.torMode = value.torMode
  }
  if (typeof value.torProxyUrls === "string") {
    next.torProxyUrls = value.torProxyUrls
  }
  if (
    value.torRotationStrategy === "sequential" ||
    value.torRotationStrategy === "random"
  ) {
    next.torRotationStrategy = value.torRotationStrategy
  }
  if (typeof value.torControlEnabled === "boolean") {
    next.torControlEnabled = value.torControlEnabled
  }
  if (typeof value.torControlPort === "number") {
    next.torControlPort = value.torControlPort
  }
  if (typeof value.torAutoRotate === "boolean") {
    next.torAutoRotate = value.torAutoRotate
  }
  if (typeof value.torRotationThreshold === "number") {
    next.torRotationThreshold = value.torRotationThreshold
  }
  return next
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

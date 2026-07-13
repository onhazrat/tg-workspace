import { useEffect, useMemo, useRef, useState } from "react"
import { loadNetworkSettings, saveNetworkSettings } from "@/lib/repository"
import { parseProxyList } from "@/lib/syncSettings"
import {
  buildNetworkSavePayload,
  mergeNetworkSettings,
  NETWORK_SETTINGS_DEFAULTS,
  type NetworkSettingSetters,
  type NetworkSettings,
  type WritableNetworkKey,
} from "./network"

/**
 * Server-backed network/proxy/Tor settings: hydrates ONCE on mount (merging
 * legacy localStorage "proxyEnabled"/"torEnabled" values and writing them back),
 * then debounce-saves any change 400ms after it settles.
 */
export function useNetworkSettings(): {
  network: NetworkSettings
  setters: NetworkSettingSetters
} {
  const [network, setNetwork] = useState<NetworkSettings>(
    NETWORK_SETTINGS_DEFAULTS,
  )
  const hydrated = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setters = useMemo<NetworkSettingSetters>(() => {
    const setField =
      <K extends WritableNetworkKey>(key: K) =>
      (value: NetworkSettings[K]) =>
        setNetwork((prev) => {
          if (Object.is(prev[key], value)) return prev
          const next = { ...prev }
          next[key] = value
          return next
        })
    return {
      setProxyEnabled: setField("proxyEnabled"),
      setDefaultProxyUrls: setField("defaultProxyUrls"),
      setProxyDefaultConcurrency: setField("proxyDefaultConcurrency"),
      setProxyConcurrencyOverrides: setField("proxyConcurrencyOverrides"),
      setTorEnabled: setField("torEnabled"),
      setTorMode: setField("torMode"),
      setTorProxyUrls: setField("torProxyUrls"),
      setTorRotationStrategy: setField("torRotationStrategy"),
      setTorControlEnabled: setField("torControlEnabled"),
      setTorControlPort: setField("torControlPort"),
      setTorAutoRotate: setField("torAutoRotate"),
      setTorRotationThreshold: setField("torRotationThreshold"),
    }
  }, [])

  // Hydrate ONCE on mount (the previous implementation accidentally re-ran on
  // every tor* state change because of its effect deps).
  useEffect(() => {
    if (typeof window === "undefined") return
    localStorage.removeItem("proxyUrls")
    localStorage.removeItem("torControlPassword")

    if (!localStorage.getItem("access_token")) return

    loadNetworkSettings()
      .then((value) => {
        const legacy: Record<string, unknown> = {}
        const legacyProxyEnabled = localStorage.getItem("proxyEnabled")
        if (legacyProxyEnabled !== null && value.proxyEnabled === undefined) {
          legacy.proxyEnabled = legacyProxyEnabled === "true"
        }
        const legacyTorEnabled = localStorage.getItem("torEnabled")
        if (legacyTorEnabled !== null && value.torEnabled === undefined) {
          legacy.torEnabled = legacyTorEnabled === "true"
        }
        const merged = { ...value, ...legacy }
        const next = mergeNetworkSettings(NETWORK_SETTINGS_DEFAULTS, merged)
        setNetwork((prev) => mergeNetworkSettings(prev, merged))
        hydrated.current = true
        if (Object.keys(legacy).length > 0) {
          saveNetworkSettings({
            proxyEnabled: legacy.proxyEnabled,
            proxyUrls: parseProxyList(next.defaultProxyUrls),
            torEnabled: legacy.torEnabled,
            torMode: next.torMode,
            torProxyUrls: next.torProxyUrls,
            torRotationStrategy: next.torRotationStrategy,
            torControlEnabled: next.torControlEnabled,
            torControlPort: next.torControlPort,
            torAutoRotate: next.torAutoRotate,
            torRotationThreshold: next.torRotationThreshold,
          }).catch(console.error)
        }
      })
      .catch(console.error)
  }, [])

  // Debounced save of any writable field change (post-hydration only).
  useEffect(() => {
    if (!hydrated.current || !localStorage.getItem("access_token")) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveNetworkSettings(buildNetworkSavePayload(network)).catch(console.error)
    }, 400)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [
    network.proxyEnabled,
    network.defaultProxyUrls,
    network.proxyDefaultConcurrency,
    network.proxyConcurrencyOverrides,
    network.torEnabled,
    network.torMode,
    network.torProxyUrls,
    network.torRotationStrategy,
    network.torControlEnabled,
    network.torControlPort,
    network.torAutoRotate,
    network.torRotationThreshold,
  ])

  return { network, setters }
}

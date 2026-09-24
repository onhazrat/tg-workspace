/**
 * What the Network Telemetry panel computes from the network log, kept free of
 * React so the arithmetic can be tested on its own.
 */
import type { NetworkLog } from "@/types"

export type TorStatus = {
  running: boolean
  socksInUse: boolean
  controlInUse: boolean
  autoSpawned: boolean
}

export type ProxyMatrixRow = {
  proxy: string
  requests: number
  successRate: string
  avgLatency: number
  rateLimits: number
  isTor: boolean
  isDirect: boolean
}

export type TelemetryStats = {
  totalRequests: number
  successRate: string
  rateLimits: number
  avgLatency: number
  directRequests: number
  torRequests: number
  proxyRequests: number
  proxyMatrix: ProxyMatrixRow[]
}

/** A proxy on the loopback interface is the local Tor SOCKS port. */
export const isTorProxy = (proxy: string): boolean =>
  proxy.includes("127.0.0.1") || proxy.includes("localhost")

/** Share of `total` as a bar width percentage; 0 with nothing to divide. */
export const sharePercent = (part: number, total: number): number =>
  total > 0 ? (part / total) * 100 : 0

type ProxyTally = {
  requests: number
  successes: number
  totalDuration: number
  rateLimits: number
}

function tallyByProxy(logs: NetworkLog[]): Map<string, ProxyTally> {
  const tallies = new Map<string, ProxyTally>()
  for (const log of logs) {
    const proxy = log.proxyUsed || "direct"
    let t = tallies.get(proxy)
    if (!t) {
      t = { requests: 0, successes: 0, totalDuration: 0, rateLimits: 0 }
      tallies.set(proxy, t)
    }
    t.requests++
    if (log.status === "success") t.successes++
    if (log.statusCode === 429) t.rateLimits++
    t.totalDuration += log.duration || 0
  }
  return tallies
}

/** One row per route (a proxy, or `direct`), busiest first. */
export function proxyMatrix(logs: NetworkLog[]): ProxyMatrixRow[] {
  return [...tallyByProxy(logs)]
    .map(([proxy, t]) => ({
      proxy,
      requests: t.requests,
      successRate: ((t.successes / t.requests) * 100).toFixed(1),
      avgLatency: Math.round(t.totalDuration / t.requests),
      rateLimits: t.rateLimits,
      isTor: isTorProxy(proxy),
      isDirect: proxy === "direct",
    }))
    .sort((a, b) => b.requests - a.requests)
}

export function telemetryStats(logs: NetworkLog[]): TelemetryStats {
  const totalRequests = logs.length
  const count = (pred: (l: NetworkLog) => boolean) => logs.filter(pred).length
  const successful = count((l) => l.status === "success")
  const totalDuration = logs.reduce((acc, l) => acc + (l.duration || 0), 0)
  const directRequests = count((l) => !l.proxyUsed || l.proxyUsed === "direct")
  const torRequests = count((l) =>
    Boolean(l.proxyUsed && isTorProxy(l.proxyUsed)),
  )
  return {
    totalRequests,
    successRate:
      totalRequests > 0
        ? ((successful / totalRequests) * 100).toFixed(1)
        : "0.0",
    rateLimits: count((l) => l.statusCode === 429),
    avgLatency:
      totalRequests > 0 ? Math.round(totalDuration / totalRequests) : 0,
    directRequests,
    torRequests,
    proxyRequests: totalRequests - directRequests - torRequests,
    proxyMatrix: proxyMatrix(logs),
  }
}

/** The badge colour for a route's success rate in the health matrix. */
export function successRateTone(rate: string): string {
  const n = Number(rate)
  if (n > 90) return "bg-green-500/10 text-green-600"
  if (n > 50) return "bg-yellow-500/10 text-yellow-600"
  return "bg-red-500/10 text-red-600"
}

/** Who runs the Tor process: the app, something else, or nothing. */
export function torProcessLabel(status: TorStatus | null): string {
  if (status?.autoSpawned) return "Managed"
  return status?.running ? "External" : "Offline"
}

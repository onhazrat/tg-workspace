import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
  RefreshCw,
  Server,
  Shield,
  XCircle,
} from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useEffect, useState } from "react"
import { api } from "@/api"
import { listNetworkLogs } from "../lib/repository"
import type { NetworkLog } from "../types"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

export const NetworkTelemetry: React.FC = () => {
  const [logs, setLogs] = useState<NetworkLog[]>([])
  const [loading, setLoading] = useState(true)
  const [torStatus, setTorStatus] = useState<any>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const fetchedLogs = await listNetworkLogs()
      setLogs(fetchedLogs.sort((a, b) => b.timestamp - a.timestamp))

      try {
        const status = await api.torStatus()
        setTorStatus(status)
      } catch (e) {
        console.error("Failed to fetch Tor status", e)
      }
    } catch (error) {
      console.error("Failed to load network logs", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 10000) // Auto-refresh every 10s
    return () => clearInterval(interval)
  }, [loadData])

  // Calculate Stats
  const totalRequests = logs.length
  const successfulRequests = logs.filter((l) => l.status === "success").length
  const successRate =
    totalRequests > 0
      ? ((successfulRequests / totalRequests) * 100).toFixed(1)
      : "0.0"

  const rateLimits = logs.filter((l) => l.statusCode === 429).length

  const avgLatency =
    totalRequests > 0
      ? Math.round(
          logs.reduce((acc, l) => acc + (l.duration || 0), 0) / totalRequests,
        )
      : 0

  // Routing Distribution
  const directRequests = logs.filter(
    (l) => !l.proxyUsed || l.proxyUsed === "direct",
  ).length
  const torRequests = logs.filter(
    (l) =>
      l.proxyUsed &&
      (l.proxyUsed.includes("127.0.0.1") || l.proxyUsed.includes("localhost")),
  ).length
  const proxyRequests = totalRequests - directRequests - torRequests

  // Proxy Performance Matrix
  const proxyStats = logs.reduce((acc: any, log) => {
    const proxy = log.proxyUsed || "direct"
    if (!acc[proxy]) {
      acc[proxy] = {
        requests: 0,
        successes: 0,
        totalDuration: 0,
        rateLimits: 0,
      }
    }
    acc[proxy].requests++
    if (log.status === "success") acc[proxy].successes++
    if (log.statusCode === 429) acc[proxy].rateLimits++
    acc[proxy].totalDuration += log.duration || 0
    return acc
  }, {})

  const proxyMatrix = Object.entries(proxyStats)
    .map(([proxy, stats]: [string, any]) => ({
      proxy,
      requests: stats.requests,
      successRate: ((stats.successes / stats.requests) * 100).toFixed(1),
      avgLatency: Math.round(stats.totalDuration / stats.requests),
      rateLimits: stats.rateLimits,
      isTor: proxy.includes("127.0.0.1") || proxy.includes("localhost"),
      isDirect: proxy === "direct",
    }))
    .sort((a, b) => b.requests - a.requests)

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full opacity-50">
        <RefreshCw className="animate-spin w-6 h-6" />
      </div>
    )
  }

  return (
    <motion.div
      key="telemetry"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="bg-app-card p-8 border border-app-ink/10 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <div className="text-left">
            <h3 className="text-sm uppercase font-bold tracking-widest flex items-center gap-2">
              <Activity size={14} className="opacity-40" /> Network Telemetry
            </h3>
            <p className="text-[10px] italic serif opacity-50 mt-1">
              Monitor connection health, proxy performance, and Tor status.
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={loadData}
                className="p-2 hover:bg-app-ink/5 rounded-full transition-colors opacity-60 hover:opacity-100"
              >
                <RefreshCw size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Refresh Data</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Top Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="border border-app-ink/10 p-6 bg-app-card shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 mb-6 opacity-40">
                <Activity size={16} />
                <h4 className="text-[11px] uppercase font-bold tracking-widest">
                  Total Requests
                </h4>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Count
                  </span>
                  <span className="font-mono font-bold text-[12px]">
                    {totalRequests}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Success Rate
                  </span>
                  <span
                    className={`font-mono font-bold text-[12px] ${Number(successRate) > 90 ? "text-green-500" : "text-yellow-500"}`}
                  >
                    {successRate}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="border border-app-ink/10 p-6 bg-app-card shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 mb-6 opacity-40">
                <Clock size={16} />
                <h4 className="text-[11px] uppercase font-bold tracking-widest">
                  Avg Latency
                </h4>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Latency
                  </span>
                  <span className="font-mono font-bold text-[12px]">
                    {avgLatency}ms
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Scope
                  </span>
                  <span className="font-mono font-bold text-[10px]">
                    All Routes
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="border border-app-ink/10 p-6 bg-app-card shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 mb-6 opacity-40">
                <AlertTriangle size={16} />
                <h4 className="text-[11px] uppercase font-bold tracking-widest">
                  Rate Limits
                </h4>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    429 Errors
                  </span>
                  <span className="font-mono font-bold text-[12px] text-orange-500">
                    {rateLimits}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Source
                  </span>
                  <span className="font-mono font-bold text-[10px]">
                    Telegram API
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="border border-app-ink/10 p-6 bg-app-card shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 mb-6 opacity-40">
                <Shield size={16} />
                <h4 className="text-[11px] uppercase font-bold tracking-widest">
                  Tor Status
                </h4>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Status
                  </span>
                  <span
                    className={`font-mono font-bold text-[10px] uppercase ${torStatus?.running ? "text-green-500" : "opacity-50"}`}
                  >
                    {torStatus?.running ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Management
                  </span>
                  <span className="font-mono font-bold text-[10px]">
                    {torStatus?.autoSpawned ? "App Managed" : "External/None"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* tg-ui-allow: Routing Distribution — icon-in-h4 header fights TgSettingsSection */}
          <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
            <h4 className="text-[11px] uppercase font-bold tracking-widest mb-6 flex items-center gap-3 opacity-80">
              <Globe size={16} className="opacity-40" />
              Routing Distribution
            </h4>
            <div className="space-y-6">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Direct
                  </span>
                  <span className="font-mono font-bold text-[12px]">
                    {directRequests}
                  </span>
                </div>
                <div className="w-full bg-app-ink/5 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full"
                    style={{
                      width: `${totalRequests > 0 ? (directRequests / totalRequests) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Custom Proxies
                  </span>
                  <span className="font-mono font-bold text-[12px]">
                    {proxyRequests}
                  </span>
                </div>
                <div className="w-full bg-app-ink/5 rounded-full h-1.5">
                  <div
                    className="bg-purple-500 h-1.5 rounded-full"
                    style={{
                      width: `${totalRequests > 0 ? (proxyRequests / totalRequests) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Tor Network
                  </span>
                  <span className="font-mono font-bold text-[12px]">
                    {torRequests}
                  </span>
                </div>
                <div className="w-full bg-app-ink/5 rounded-full h-1.5">
                  <div
                    className="bg-green-500 h-1.5 rounded-full"
                    style={{
                      width: `${totalRequests > 0 ? (torRequests / totalRequests) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* tg-ui-allow: Tor Telemetry Details — icon-in-h4 header fights TgSettingsSection */}
          <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm lg:col-span-2">
            <h4 className="text-[11px] uppercase font-bold tracking-widest mb-6 flex items-center gap-3 opacity-80">
              <Shield size={16} className="opacity-40" />
              Tor Network Telemetry
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 border border-app-ink/10 bg-app-muted/30">
                <div className="text-[10px] uppercase opacity-50 tracking-widest mb-2">
                  SOCKS5 Port (9050)
                </div>
                <div className="flex items-center gap-2">
                  {torStatus?.socksInUse ? (
                    <CheckCircle2 size={14} className="text-green-500" />
                  ) : (
                    <XCircle size={14} className="text-red-500" />
                  )}
                  <span className="font-mono font-bold text-[10px] uppercase">
                    {torStatus?.socksInUse ? "Bound & Active" : "Not Bound"}
                  </span>
                </div>
              </div>
              <div className="p-4 border border-app-ink/10 bg-app-muted/30">
                <div className="text-[10px] uppercase opacity-50 tracking-widest mb-2">
                  Control Port (9051)
                </div>
                <div className="flex items-center gap-2">
                  {torStatus?.controlInUse ? (
                    <CheckCircle2 size={14} className="text-green-500" />
                  ) : (
                    <XCircle size={14} className="text-red-500" />
                  )}
                  <span className="font-mono font-bold text-[10px] uppercase">
                    {torStatus?.controlInUse ? "Bound & Active" : "Not Bound"}
                  </span>
                </div>
              </div>
              <div className="p-4 border border-app-ink/10 bg-app-muted/30">
                <div className="text-[10px] uppercase opacity-50 tracking-widest mb-2">
                  Total Tor Requests
                </div>
                <div className="font-mono font-bold text-[14px]">
                  {torRequests}
                </div>
              </div>
              <div className="p-4 border border-app-ink/10 bg-app-muted/30">
                <div className="text-[10px] uppercase opacity-50 tracking-widest mb-2">
                  Process Status
                </div>
                <div className="font-mono font-bold text-[10px] uppercase">
                  {torStatus?.autoSpawned
                    ? "Managed"
                    : torStatus?.running
                      ? "External"
                      : "Offline"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Proxy Health Matrix */}
        <div className="bg-app-card border border-app-ink/10 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-app-ink/10">
            <h4 className="text-[11px] uppercase font-bold tracking-widest flex items-center gap-3 opacity-80">
              <Server size={16} className="opacity-40" />
              Proxy Health Matrix
            </h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-app-muted/50 border-b border-app-ink/10">
                <tr>
                  <th className="px-6 py-3 text-[10px] uppercase tracking-widest opacity-60 font-bold">
                    Routing Method / Proxy
                  </th>
                  <th className="px-6 py-3 text-[10px] uppercase tracking-widest opacity-60 font-bold">
                    Requests
                  </th>
                  <th className="px-6 py-3 text-[10px] uppercase tracking-widest opacity-60 font-bold">
                    Success Rate
                  </th>
                  <th className="px-6 py-3 text-[10px] uppercase tracking-widest opacity-60 font-bold">
                    Avg Latency
                  </th>
                  <th className="px-6 py-3 text-[10px] uppercase tracking-widest opacity-60 font-bold">
                    Rate Limits
                  </th>
                  <th className="px-6 py-3 text-[10px] uppercase tracking-widest opacity-60 font-bold">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-ink/5">
                {proxyMatrix.map((row, i) => (
                  <tr key={i} className="hover:bg-app-ink/5 transition-colors">
                    <td className="px-6 py-4 font-mono text-[11px] flex items-center gap-2">
                      {row.isDirect && (
                        <Globe size={14} className="text-blue-500" />
                      )}
                      {row.isTor && (
                        <Shield size={14} className="text-green-500" />
                      )}
                      {!row.isDirect && !row.isTor && (
                        <Server size={14} className="text-purple-500" />
                      )}
                      {row.proxy}
                    </td>
                    <td className="px-6 py-4 font-mono text-[11px]">
                      {row.requests}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-mono font-bold uppercase ${
                          Number(row.successRate) > 90
                            ? "bg-green-500/10 text-green-600"
                            : Number(row.successRate) > 50
                              ? "bg-yellow-500/10 text-yellow-600"
                              : "bg-red-500/10 text-red-600"
                        }`}
                      >
                        {row.successRate}%
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-[11px]">
                      {row.avgLatency}ms
                    </td>
                    <td className="px-6 py-4 font-mono text-[11px]">
                      {row.rateLimits > 0 ? (
                        <span className="text-orange-500 font-bold">
                          {row.rateLimits}
                        </span>
                      ) : (
                        <span className="opacity-40">0</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {Number(row.successRate) > 50 ? (
                        <span className="flex items-center gap-1 text-green-500 text-[10px] uppercase font-bold tracking-widest">
                          <CheckCircle2 size={12} /> Healthy
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-500 text-[10px] uppercase font-bold tracking-widest">
                          <AlertTriangle size={12} /> Unhealthy
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {proxyMatrix.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-8 text-center text-[11px] opacity-50 italic"
                    >
                      No network telemetry data available yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

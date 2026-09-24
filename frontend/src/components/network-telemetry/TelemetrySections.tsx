import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
  type LucideIcon,
  Server,
  Shield,
  XCircle,
} from "lucide-react"
import type React from "react"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import {
  type ProxyMatrixRow,
  sharePercent,
  successRateTone,
  type TelemetryStats,
  type TorStatus,
  torProcessLabel,
} from "./telemetry-model"

const ROW_LABEL = "text-[10px] uppercase opacity-50 tracking-widest"
const VALUE = "font-mono font-bold text-[12px]"
const SMALL_VALUE = "font-mono font-bold text-[10px]"
const CELL = "px-6 py-4 font-mono text-[11px]"
const HEADER_CELL =
  "px-6 py-3 text-[10px] uppercase tracking-widest opacity-60 font-bold"

/** One of the four cards on the top row: a titled pair of label/value rows. */
function StatCard({
  icon: Icon,
  title,
  rows,
}: {
  icon: LucideIcon
  title: string
  rows: { label: string; value: React.ReactNode; className: string }[]
}) {
  return (
    <div className="border border-app-ink/10 p-6 bg-app-card shadow-sm flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-3 mb-6 opacity-40">
          <Icon size={16} />
          <h4 className="text-[11px] uppercase font-bold tracking-widest">
            {title}
          </h4>
        </div>
        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between items-center">
              <span className={ROW_LABEL}>{row.label}</span>
              <span className={row.className}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The top row: requests, latency, rate limits and Tor status. */
export function TelemetryStatCards({
  stats,
  torStatus,
}: {
  stats: TelemetryStats
  torStatus: TorStatus | null
}) {
  const healthy = Number(stats.successRate) > 90
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <StatCard
        icon={Activity}
        title="Total Requests"
        rows={[
          { label: "Count", value: stats.totalRequests, className: VALUE },
          {
            label: "Success Rate",
            value: `${stats.successRate}%`,
            className: `${VALUE} ${healthy ? "text-green-500" : "text-yellow-500"}`,
          },
        ]}
      />
      <StatCard
        icon={Clock}
        title="Avg Latency"
        rows={[
          {
            label: "Latency",
            value: `${stats.avgLatency}ms`,
            className: VALUE,
          },
          { label: "Scope", value: "All Routes", className: SMALL_VALUE },
        ]}
      />
      <StatCard
        icon={AlertTriangle}
        title="Rate Limits"
        rows={[
          {
            label: "429 Errors",
            value: stats.rateLimits,
            className: `${VALUE} text-orange-500`,
          },
          { label: "Source", value: "Telegram API", className: SMALL_VALUE },
        ]}
      />
      <StatCard
        icon={Shield}
        title="Tor Status"
        rows={[
          {
            label: "Status",
            value: torStatus?.running ? "Active" : "Inactive",
            className: `${SMALL_VALUE} uppercase ${torStatus?.running ? "text-green-500" : "opacity-50"}`,
          },
          {
            label: "Management",
            value: torStatus?.autoSpawned ? "App Managed" : "External/None",
            className: SMALL_VALUE,
          },
        ]}
      />
    </div>
  )
}

function RoutingBar({
  label,
  count,
  total,
  barClassName,
}: {
  label: string
  count: number
  total: number
  barClassName: string
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className={ROW_LABEL}>{label}</span>
        <span className={VALUE}>{count}</span>
      </div>
      <div className="w-full bg-app-ink/5 rounded-full h-1.5">
        <div
          className={`${barClassName} h-1.5 rounded-full`}
          style={{ width: `${sharePercent(count, total)}%` }}
        />
      </div>
    </div>
  )
}

export function RoutingDistribution({ stats }: { stats: TelemetryStats }) {
  const total = stats.totalRequests
  return (
    <TgSettingsSection
      icon={Globe}
      title="Routing Distribution"
      titleClassName="text-[11px] opacity-80"
    >
      <div className="space-y-6">
        <RoutingBar
          label="Direct"
          count={stats.directRequests}
          total={total}
          barClassName="bg-blue-500"
        />
        <RoutingBar
          label="Custom Proxies"
          count={stats.proxyRequests}
          total={total}
          barClassName="bg-purple-500"
        />
        <RoutingBar
          label="Tor Network"
          count={stats.torRequests}
          total={total}
          barClassName="bg-green-500"
        />
      </div>
    </TgSettingsSection>
  )
}

function TorTile({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="p-4 border border-app-ink/10 bg-app-muted/30">
      <div className="text-[10px] uppercase opacity-50 tracking-widest mb-2">
        {label}
      </div>
      {children}
    </div>
  )
}

function PortStatus({ bound }: { bound: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {bound ? (
        <CheckCircle2 size={14} className="text-green-500" />
      ) : (
        <XCircle size={14} className="text-red-500" />
      )}
      <span className={`${SMALL_VALUE} uppercase`}>
        {bound ? "Bound & Active" : "Not Bound"}
      </span>
    </div>
  )
}

export function TorTelemetry({
  torStatus,
  torRequests,
}: {
  torStatus: TorStatus | null
  torRequests: number
}) {
  return (
    <TgSettingsSection
      icon={Shield}
      title="Tor Network Telemetry"
      className="lg:col-span-2"
      titleClassName="text-[11px] opacity-80"
    >
      <div className="grid grid-cols-2 gap-4">
        <TorTile label="SOCKS5 Port (9050)">
          <PortStatus bound={Boolean(torStatus?.socksInUse)} />
        </TorTile>
        <TorTile label="Control Port (9051)">
          <PortStatus bound={Boolean(torStatus?.controlInUse)} />
        </TorTile>
        <TorTile label="Total Tor Requests">
          <div className="font-mono font-bold text-[14px]">{torRequests}</div>
        </TorTile>
        <TorTile label="Process Status">
          <div className={`${SMALL_VALUE} uppercase`}>
            {torProcessLabel(torStatus)}
          </div>
        </TorTile>
      </div>
    </TgSettingsSection>
  )
}

function RouteIcon({ row }: { row: ProxyMatrixRow }) {
  if (row.isDirect) return <Globe size={14} className="text-blue-500" />
  if (row.isTor) return <Shield size={14} className="text-green-500" />
  return <Server size={14} className="text-purple-500" />
}

export function ProxyMatrixTableRow({ row }: { row: ProxyMatrixRow }) {
  const healthy = Number(row.successRate) > 50
  return (
    <tr className="hover:bg-app-ink/5 transition-colors">
      <td className={`${CELL} flex items-center gap-2`}>
        <RouteIcon row={row} />
        {row.proxy}
      </td>
      <td className={CELL}>{row.requests}</td>
      <td className="px-6 py-4">
        <span
          className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-mono font-bold uppercase ${successRateTone(row.successRate)}`}
        >
          {row.successRate}%
        </span>
      </td>
      <td className={CELL}>{row.avgLatency}ms</td>
      <td className={CELL}>
        {row.rateLimits > 0 ? (
          <span className="text-orange-500 font-bold">{row.rateLimits}</span>
        ) : (
          <span className="opacity-40">0</span>
        )}
      </td>
      <td className="px-6 py-4">
        {healthy ? (
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
  )
}

const MATRIX_COLUMNS = [
  "Routing Method / Proxy",
  "Requests",
  "Success Rate",
  "Avg Latency",
  "Rate Limits",
  "Status",
]

export function ProxyHealthMatrix({ rows }: { rows: ProxyMatrixRow[] }) {
  return (
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
              {MATRIX_COLUMNS.map((c) => (
                <th key={c} className={HEADER_CELL}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-app-ink/5">
            {rows.map((row, i) => (
              <ProxyMatrixTableRow key={i} row={row} />
            ))}
            {rows.length === 0 && (
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
  )
}

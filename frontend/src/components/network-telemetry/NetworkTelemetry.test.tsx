/**
 * The Network Telemetry panel's arithmetic and the props-only sections it
 * renders. The two queries and the refresh stay in `NetworkTelemetry`.
 *
 * What is pinned is how a log row is classified (direct, Tor on the loopback,
 * or a custom proxy), that an empty log divides by nothing, and the thresholds
 * at which a route turns yellow, red and unhealthy.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import type { NetworkLog } from "@/types"
import {
  ProxyHealthMatrix,
  RoutingDistribution,
  TelemetryStatCards,
  TorTelemetry,
} from "./TelemetrySections"
import {
  isTorProxy,
  sharePercent,
  successRateTone,
  telemetryStats,
  torProcessLabel,
} from "./telemetry-model"

afterEach(cleanup)

const log = (over: Partial<NetworkLog>): NetworkLog => ({
  id: "x",
  url: "u",
  method: "GET",
  status: "success",
  duration: 100,
  timestamp: 0,
  source: "t",
  ...over,
})

const logs = [
  log({}),
  log({ proxyUsed: "direct", duration: 300 }),
  log({ proxyUsed: "socks5h://127.0.0.1:9050", status: "failed" }),
  log({ proxyUsed: "socks5h://localhost:9050", statusCode: 429 }),
  log({ proxyUsed: "http://p1:8080", duration: 0 }),
  log({ proxyUsed: "http://p1:8080", status: "failed", statusCode: 429 }),
]

describe("telemetryStats", () => {
  test("an empty log divides by nothing", () => {
    expect(telemetryStats([])).toEqual({
      totalRequests: 0,
      successRate: "0.0",
      rateLimits: 0,
      avgLatency: 0,
      directRequests: 0,
      torRequests: 0,
      proxyRequests: 0,
      proxyMatrix: [],
    })
  })

  test("classifies each row as direct, Tor or a custom proxy", () => {
    const stats = telemetryStats(logs)
    expect(stats.totalRequests).toBe(6)
    expect(stats.successRate).toBe("66.7")
    expect(stats.rateLimits).toBe(2)
    // (100 + 300 + 100 + 100 + 0 + 100) / 6
    expect(stats.avgLatency).toBe(117)
    expect(stats.directRequests).toBe(2)
    expect(stats.torRequests).toBe(2)
    expect(stats.proxyRequests).toBe(2)
  })

  test("the matrix has one row per route, busiest first", () => {
    const rows = telemetryStats(logs).proxyMatrix
    expect(rows.map((r) => [r.proxy, r.requests])).toEqual([
      ["direct", 2],
      ["http://p1:8080", 2],
      ["socks5h://127.0.0.1:9050", 1],
      ["socks5h://localhost:9050", 1],
    ])
    expect(rows[0]).toMatchObject({
      successRate: "100.0",
      avgLatency: 200,
      isDirect: true,
      isTor: false,
    })
    expect(rows[1]).toMatchObject({
      successRate: "50.0",
      avgLatency: 50,
      rateLimits: 1,
      isDirect: false,
      isTor: false,
    })
    expect(rows[2].isTor).toBe(true)
  })

  test("loopback is Tor; bar widths are a share of the total", () => {
    expect(isTorProxy("socks5h://127.0.0.1:9050")).toBe(true)
    expect(isTorProxy("socks5://localhost:9150")).toBe(true)
    expect(isTorProxy("http://10.0.0.1:80")).toBe(false)
    expect(sharePercent(1, 4)).toBe(25)
    expect(sharePercent(0, 0)).toBe(0)
  })

  test("success rate turns yellow at 90 and red at 50", () => {
    expect(successRateTone("90.1")).toContain("green")
    expect(successRateTone("90.0")).toContain("yellow")
    expect(successRateTone("50.1")).toContain("yellow")
    expect(successRateTone("50.0")).toContain("red")
  })

  test("the Tor process is managed, external or offline", () => {
    const status = {
      running: true,
      socksInUse: true,
      controlInUse: false,
      autoSpawned: false,
    }
    expect(torProcessLabel({ ...status, autoSpawned: true })).toBe("Managed")
    expect(torProcessLabel(status)).toBe("External")
    expect(torProcessLabel({ ...status, running: false })).toBe("Offline")
    expect(torProcessLabel(null)).toBe("Offline")
  })
})

describe("telemetry sections", () => {
  const stats = telemetryStats(logs)

  test("the stat cards read the stats and the Tor status", () => {
    const { container, rerender } = render(
      <TelemetryStatCards stats={stats} torStatus={null} />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain("Count6")
    expect(text).toContain("Success Rate66.7%")
    expect(text).toContain("Latency117ms")
    expect(text).toContain("429 Errors2")
    expect(text).toContain("StatusInactive")
    expect(text).toContain("ManagementExternal/None")
    expect(screen.getByText("66.7%").className).toContain("text-yellow-500")
    rerender(
      <TelemetryStatCards
        stats={{ ...stats, successRate: "95.0" }}
        torStatus={{
          running: true,
          socksInUse: true,
          controlInUse: true,
          autoSpawned: true,
        }}
      />,
    )
    expect(screen.getByText("95.0%").className).toContain("text-green-500")
    expect(screen.getByText("Active").className).toContain("text-green-500")
    expect(screen.getByText("App Managed")).toBeTruthy()
  })

  test("routing bars are sized by share", () => {
    const { container } = render(<RoutingDistribution stats={stats} />)
    const widths = [
      ...container.querySelectorAll<HTMLElement>(
        ".h-1\\.5.rounded-full[style]",
      ),
    ].map((el) => el.style.width)
    expect(widths).toHaveLength(3)
    expect(widths.every((w) => w.startsWith("33.33"))).toBe(true)
  })

  test("Tor ports read bound or not bound", () => {
    render(
      <TorTelemetry
        torStatus={{
          running: true,
          socksInUse: true,
          controlInUse: false,
          autoSpawned: false,
        }}
        torRequests={4}
      />,
    )
    expect(screen.getByText("Bound & Active")).toBeTruthy()
    expect(screen.getByText("Not Bound")).toBeTruthy()
    expect(screen.getByText("4")).toBeTruthy()
    expect(screen.getByText("External")).toBeTruthy()
  })

  test("the matrix marks healthy and unhealthy routes, or says it is empty", () => {
    const { rerender } = render(<ProxyHealthMatrix rows={[]} />)
    expect(
      screen.getByText("No network telemetry data available yet."),
    ).toBeTruthy()
    rerender(
      <ProxyHealthMatrix
        rows={[
          ...stats.proxyMatrix,
          { ...stats.proxyMatrix[1], proxy: "bad", successRate: "10.0" },
          { ...stats.proxyMatrix[1], proxy: "fair", successRate: "75.0" },
        ]}
      />,
    )
    const rows = screen.getAllByRole("row").slice(1)
    expect(rows.map((r) => r.textContent)).toEqual([
      "direct2100.0%200ms0 Healthy",
      "http://p1:8080250.0%50ms1 Unhealthy",
      // 1 request, 0.0% success.
      "socks5h://127.0.0.1:905010.0%100ms0 Unhealthy",
      "socks5h://localhost:90501100.0%100ms1 Healthy",
      "bad210.0%50ms1 Unhealthy",
      // Yellow, but still healthy: the badge turns at 90, the status at 50.
      "fair275.0%50ms1 Healthy",
    ])
  })
})

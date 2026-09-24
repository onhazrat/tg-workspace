import { CheckCircle2, RotateCw, XCircle } from "lucide-react"
import type { ProxyTestResult } from "./useProxyTesting"

type Results = Record<string, ProxyTestResult>

/**
 * The proxies in a pasted list that have a test result, in list order. The
 * list is split the way `handleTestAllProxies` splits it, so a result shows
 * against the line it was run for and a stale one (for a line since removed)
 * does not.
 */
export const testedProxies = (list: string, results: Results): string[] =>
  list
    .split(/[\n,]+/)
    .map((p) => p.trim())
    .filter((p) => p && results[p])

/** One line's latency and exit IP, the error on hover, or that it is running. */
function ProxyTestOutcome({ result }: { result: ProxyTestResult }) {
  if (result.testing)
    return (
      <span className="flex items-center gap-1 opacity-40">
        <RotateCw size={8} className="animate-spin" /> Testing...
      </span>
    )
  if (result.success)
    return (
      <>
        <span className="text-green-600 font-bold flex items-center gap-1">
          <CheckCircle2 size={8} /> {result.latency}ms
        </span>
        <span className="opacity-40 font-mono">({result.ip})</span>
      </>
    )
  return (
    <span
      className="text-red-600 font-bold flex items-center gap-1"
      title={result.error}
    >
      <XCircle size={8} /> Error
    </span>
  )
}

/**
 * The test results for a proxy list, or nothing when no line has one. `display`
 * is how a line is shown: the proxy panel masks credentials through it, and
 * the Tor pool (host:port lines) shows them as typed.
 */
export function ProxyTestResults({
  list,
  results,
  display = (url) => url,
}: {
  list: string
  results: Results
  display?: (url: string) => string
}) {
  const tested = testedProxies(list, results)
  if (tested.length === 0) return null
  return (
    <div className="space-y-1 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
      {tested.map((url, idx) => (
        <div
          key={idx}
          className="flex items-center justify-between text-[9px] bg-app-ink/5 p-2 border border-app-ink/5 rounded"
          data-testid="proxy-test-result"
        >
          <span className="font-mono truncate max-w-[150px] opacity-60">
            {display(url)}
          </span>
          <div className="flex items-center gap-2">
            <ProxyTestOutcome result={results[url]} />
          </div>
        </div>
      ))}
    </div>
  )
}

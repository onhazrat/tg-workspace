import { useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import { useData } from "@/contexts/DataContext"
import { saveNetworkLog } from "@/lib/logs/write"
import type { NetworkLog } from "@/types"

export type ProxyTestResult = {
  success?: boolean
  ip?: string
  latency?: number
  error?: string
  testing?: boolean
}

export function useProxyTesting() {
  const { loadNetworkLogs } = useData()
  const [proxyTestResults, setProxyTestResults] = useState<
    Record<string, ProxyTestResult>
  >({})
  const [isTestingAll, setIsTestingAll] = useState(false)

  const testProxy = async (proxyUrl: string) => {
    setProxyTestResults((prev) => ({ ...prev, [proxyUrl]: { testing: true } }))
    const startTime = Date.now()
    let status: "success" | "failed" = "failed"
    let errorMsg: string | undefined
    let telemetryData: any = null

    try {
      const data = (await api.testProxy(proxyUrl)) as {
        success?: boolean
        error?: string
      }
      setProxyTestResults((prev) => ({ ...prev, [proxyUrl]: data }))

      if (data.success) {
        status = "success"
      } else {
        errorMsg = data.error || "Proxy test failed"
      }
      telemetryData = data
    } catch (error: any) {
      errorMsg = error.message
      setProxyTestResults((prev) => ({
        ...prev,
        [proxyUrl]: { success: false, error: error.message },
      }))
    } finally {
      const logEntry: NetworkLog = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        url: "/api/v1/network/test-proxy",
        method: "POST",
        status,
        duration: Date.now() - startTime,
        error: errorMsg,
        proxyUsed: proxyUrl,
        telemetry: telemetryData,
        source: "SettingsView.testProxy",
      }
      await saveNetworkLog(logEntry)
      loadNetworkLogs()
    }
  }

  const handleTestAllProxies = async (urls: string) => {
    const list = urls
      .split(/[\n,]+/)
      .map((p) => p.trim())
      .filter((p) => p)
    if (list.length === 0) {
      toast.error("No proxies to test")
      return
    }
    setIsTestingAll(true)
    for (const url of list) {
      await testProxy(url)
    }
    setIsTestingAll(false)
    toast.success("Proxy testing complete")
  }

  const clearProxyResults = () => setProxyTestResults({})

  return {
    proxyTestResults,
    isTestingAll,
    testProxy,
    handleTestAllProxies,
    clearProxyResults,
  }
}

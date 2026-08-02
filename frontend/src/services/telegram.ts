import { api } from "@/api"
import { saveNetworkLog } from "@/lib/logs/write"
import type { NetworkLog } from "../types"

const logTelemetry = async (
  url: string,
  method: string,
  status: number,
  telemetryData: any,
  source: string,
) => {
  if (!telemetryData) return

  const logsToSave: any[] = Array.isArray(telemetryData)
    ? telemetryData
    : [telemetryData]

  for (const t of logsToSave) {
    if (!t) continue
    const logEntry: NetworkLog = {
      id: crypto.randomUUID(),
      url,
      method,
      status: t.success ? "success" : "failed",
      statusCode: status,
      duration: t.totalDuration || 0,
      source,
      timestamp: Date.now(),
      proxyUsed: t.attempts?.[t.attempts.length - 1]?.proxyUrl,
      attempts: t.attempts?.length || 1,
      telemetry: t,
    }
    try {
      await saveNetworkLog(logEntry)
    } catch (e) {
      console.error("Failed to save network log:", e)
    }
  }
}

export interface PublishResult {
  success: boolean
  error?: string
  responses?: any[]
  requests?: any[]
}

export const publishSummary = async (
  credentialId: string,
  chatId: string,
  text: string,
  metadataText?: string,
  proxyEnabled?: boolean,
  proxies?: string[],
  torAutoRotate?: boolean,
  torRotationThreshold?: number,
): Promise<PublishResult> => {
  try {
    const requestBody = {
      credentialId,
      chatId,
      text,
      metadataText,
      proxyEnabled,
      proxies,
      torAutoRotate,
      torRotationThreshold,
    }

    const data = await api.publish(requestBody)

    if (data.telemetry) {
      logTelemetry(
        "https://api.telegram.org/bot.../sendMessage",
        "POST",
        200,
        data.telemetry,
        "Publisher",
      )
    }

    const results = data.results ?? []
    const allOk =
      data.success !== false &&
      results.length > 0 &&
      results.every(
        (r) =>
          r && typeof r === "object" && (r as { ok?: boolean }).ok !== false,
      )

    if (!allOk) {
      const firstError = results.find(
        (r) =>
          r && typeof r === "object" && (r as { ok?: boolean }).ok === false,
      ) as { description?: string } | undefined
      return {
        success: false,
        // `data.error` used to lead this chain. `PublishResponse` is closed and
        // declares no `error`, and the route returns nothing else on a 200, so
        // that read could never be non-null — the generated type is what
        // proved it. Failures arrive per-chunk in `results`, or as a thrown
        // `ApiError` caught below.
        error:
          firstError?.description ??
          "Publish failed: Telegram API returned an error",
        responses: results,
        requests: [requestBody],
      }
    }

    return {
      success: data.success ?? true,
      responses: results,
      requests: [requestBody],
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      responses: [],
      requests: [],
    }
  }
}

export const fetchBotInfo = async (
  credentialId: string | undefined,
  token: string | undefined,
  method: string,
  params?: Record<string, string | number>,
  proxyEnabled?: boolean,
  proxies?: string[],
  torAutoRotate?: boolean,
  torRotationThreshold?: number,
): Promise<any> => {
  const body: Record<string, unknown> = {
    method,
    params,
    proxyEnabled,
    proxies,
    torAutoRotate,
    torRotationThreshold,
  }
  if (credentialId) {
    body.credentialId = credentialId
  } else if (token) {
    body.token = token
  }
  return api.botInfo(body)
}

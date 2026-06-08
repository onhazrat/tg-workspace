import { NetworkLog } from "../types";
import { api } from "@/api";
import { saveNetworkLog } from "../lib/repository";

const logTelemetry = async (url: string, method: string, status: number, telemetryData: any, source: string) => {
  if (!telemetryData) return;
  
  const logsToSave: any[] = Array.isArray(telemetryData) ? telemetryData : [telemetryData];
  
  for (const t of logsToSave) {
    if (!t) continue;
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
      telemetry: t
    };
    try {
      await saveNetworkLog(logEntry);
    } catch (e) {
      console.error("Failed to save network log:", e);
    }
  }
};

export interface PublishResult {
  success: boolean;
  error?: string;
  responses?: any[];
  requests?: any[];
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
    };

    const data = (await api.publish(requestBody)) as {
      success?: boolean;
      results?: unknown[];
      telemetry?: unknown;
      error?: string;
    };

    if (data.telemetry) {
      logTelemetry("https://api.telegram.org/bot.../sendMessage", "POST", 200, data.telemetry, "Publisher");
    }

    return {
      success: true,
      responses: data.results,
      requests: [requestBody],
    };
  } catch (err) {
    return { 
      success: false, 
      error: err instanceof Error ? err.message : String(err),
      responses: [],
      requests: []
    };
  }
};

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
  };
  if (credentialId) {
    body.credentialId = credentialId;
  } else if (token) {
    body.token = token;
  }
  return api.botInfo(body);
};

const API_BASE = import.meta.env.VITE_API_URL || "";
const API_KEY = import.meta.env.VITE_API_KEY || "";

function headers(json = true): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (API_KEY) h["X-API-Key"] = API_KEY;
  return h;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: { ...headers(), ...(init?.headers as Record<string, string>) },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(typeof err.detail === "string" ? err.detail : JSON.stringify(err));
  }
  return response.json() as Promise<T>;
}

export const api = {
  scrape: (body: Record<string, unknown>) =>
    request("/api/scrape", { method: "POST", body: JSON.stringify(body) }),

  channelInfo: (body: Record<string, unknown>) =>
    request("/api/channel-info", { method: "POST", body: JSON.stringify(body) }),

  botInfo: (body: Record<string, unknown>) =>
    request("/api/bot-info", { method: "POST", body: JSON.stringify(body) }),

  publish: (body: Record<string, unknown>) =>
    request("/api/publish", { method: "POST", body: JSON.stringify(body) }),

  testProxy: (proxyUrl: string) =>
    request("/api/test-proxy", {
      method: "POST",
      body: JSON.stringify({ proxyUrl }),
    }),

  proxyHealth: () => request<{ badProxies: unknown[] }>("/api/proxy-health"),

  torStatus: () =>
    request<{ running: boolean; socksInUse: boolean; controlInUse: boolean }>(
      "/api/tor-status"
    ),

  torIp: () => request<{ ip: string }>("/api/tor-ip"),

  torRestart: () => request("/api/tor-restart", { method: "POST" }),

  torNewIdentity: (port?: number) =>
    request("/api/tor-new-identity", {
      method: "POST",
      body: JSON.stringify({ port }),
    }),

  listModels: () =>
    request<{ models: { id: string; label: string; provider: string }[]; default: string }>(
      "/api/v1/ai/models"
    ),

  summaryStream: async function* (
    body: Record<string, unknown>
  ): AsyncGenerator<string> {
    const url = `${API_BASE}/api/v1/ai/summary/stream`;
    const response = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Summary stream failed");
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const payload = line.slice(6);
          if (payload === "[DONE]") return;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.text) yield parsed.text;
          } catch {
            /* ignore */
          }
        }
      }
    }
  },

  chatStream: async function* (
    body: Record<string, unknown>
  ): AsyncGenerator<string> {
    const url = `${API_BASE}/api/v1/ai/chat/stream`;
    const response = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Chat stream failed");
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const payload = line.slice(6);
          if (payload === "[DONE]") return;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.text) yield parsed.text;
          } catch {
            /* ignore */
          }
        }
      }
    }
  },

  embeddings: (texts: string[], model?: string) =>
    request<{ vectors: number[][]; dimensions: number }>("/api/v1/ai/embeddings", {
      method: "POST",
      body: JSON.stringify({ texts, model }),
    }),

  translateBatch: (
    posts: { id: string; text: string }[],
    targetLanguage: string,
    model?: string
  ) =>
    request<{ translations: { id: string; translation: string }[] }>(
      "/api/v1/ai/translate",
      {
        method: "POST",
        body: JSON.stringify({ posts, targetLanguage, model }),
      }
    ),

  ragSearch: (body: Record<string, unknown>) =>
    request("/api/v1/rag/search", { method: "POST", body: JSON.stringify(body) }),

  jobsStatus: () => request("/api/v1/jobs/status"),

  syncMeta: () => request<Record<string, { etag: string }>>("/api/v1/data/sync-meta"),
};

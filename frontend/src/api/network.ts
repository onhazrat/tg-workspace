import { request } from "./base"

export const networkApi = {
  testProxy: (proxyUrl: string) =>
    request("/api/v1/network/test-proxy", {
      method: "POST",
      body: JSON.stringify({ proxyUrl }),
    }),

  proxyHealth: () =>
    request<{ badProxies: unknown[] }>("/api/v1/network/proxy-health"),

  torStatus: () =>
    request<{ running: boolean; socksInUse: boolean; controlInUse: boolean }>(
      "/api/v1/network/tor-status",
    ),

  torIp: () => request<{ ip: string }>("/api/v1/network/tor-ip"),

  torRestart: () => request("/api/v1/network/tor-restart", { method: "POST" }),

  torNewIdentity: (port?: number) =>
    request("/api/v1/network/tor-new-identity", {
      method: "POST",
      body: JSON.stringify({ port }),
    }),
}

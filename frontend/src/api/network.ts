import {
  networkApiProxyHealth,
  networkApiTorIp,
  networkApiTorNewIdentity,
  networkApiTorRestart,
} from "@/client"
import { request } from "./base"

/**
 * Network API — split by response-model openness (see `api/jobs.ts` and
 * ADR-006 for the rule).
 *
 * `TestProxyResponse` and `TorStatusResponse` are open
 * (`ConfigDict(extra="allow")`), so their generated types carry an index
 * signature and the hand-written shapes below are the more precise ones.
 */
export const networkApi = {
  // Open response model — hand-written.
  testProxy: (proxyUrl: string) =>
    request("/api/v1/network/test-proxy", {
      method: "POST",
      body: JSON.stringify({ proxyUrl }),
    }),

  // Open response model — hand-written.
  torStatus: () =>
    request<{
      running: boolean
      socksInUse: boolean
      controlInUse: boolean
      autoSpawned: boolean
    }>("/api/v1/network/tor-status"),

  // Closed response models — generated.
  proxyHealth: () => networkApiProxyHealth(),

  torIp: () => networkApiTorIp(),

  torRestart: () => networkApiTorRestart(),

  torNewIdentity: (port?: number) =>
    networkApiTorNewIdentity({ body: { port } }),
}

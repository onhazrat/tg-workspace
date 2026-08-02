import { toast } from "sonner"

import { api } from "@/api"
import type { CommandContext } from "@/lib/commands/types"
import { saveNetworkLog } from "@/lib/logs/write"
import type { NetworkLog } from "@/types"

export async function rotateTorIpNow(ctx: CommandContext): Promise<void> {
  const startTime = Date.now()
  let status: "success" | "failed" = "failed"
  let errorMsg: string | undefined

  try {
    await api.torNewIdentity(ctx.settings.torControlPort)
    status = "success"
    toast.success("New Tor identity requested. IP will change shortly.")
  } catch (error: unknown) {
    console.error("Failed to rotate Tor IP:", error)
    errorMsg =
      error instanceof Error
        ? error.message
        : "Network error while requesting new identity"
    toast.error("Network error while requesting new identity")
  } finally {
    const logEntry: NetworkLog = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      url: "/api/v1/network/tor-new-identity",
      method: "POST",
      status,
      duration: Date.now() - startTime,
      error: errorMsg,
      proxyUsed: "socks5h://127.0.0.1:9050",
      source: "CommandPalette.rotateTorIp",
    }
    await saveNetworkLog(logEntry)
  }
}

export async function restartTorService(_ctx: CommandContext): Promise<void> {
  try {
    await api.torRestart()
    toast.success("Tor restart initiated")
  } catch (_error) {
    toast.error("Network error while restarting Tor")
  }
}

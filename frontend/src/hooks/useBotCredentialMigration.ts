import { useEffect, useRef } from "react"
import { api } from "@/api"
import { listBotCredentials } from "@/lib/bots/store"
import * as cache from "@/lib/cache"

const MIGRATED_KEY = "bot_credentials_migrated"

export async function migrateLocalBotCredentials(): Promise<number> {
  if (localStorage.getItem(MIGRATED_KEY)) return 0
  if (!localStorage.getItem("access_token")) return 0

  const localBots = await cache.getBotCredentials()
  const withTokens = localBots.filter((b) => b.token?.includes(":"))
  if (withTokens.length === 0) {
    localStorage.setItem(MIGRATED_KEY, "1")
    return 0
  }

  const result = await api.migrateBotCredentials(withTokens)
  for (const bot of withTokens) {
    await cache.deleteBotCredential(bot.id)
  }
  localStorage.setItem(MIGRATED_KEY, "1")
  await listBotCredentials()
  return result.migrated
}

export function useBotCredentialMigration(): void {
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    if (!localStorage.getItem("access_token")) return
    ran.current = true

    migrateLocalBotCredentials().catch((err) => {
      console.error("[bot-migration] failed:", err)
    })
  }, [])
}

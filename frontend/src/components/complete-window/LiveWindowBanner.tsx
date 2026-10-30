import { Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { TgButton } from "@/components/ui/tg-button"
import { useData } from "@/contexts/DataContext"
import { useSync } from "@/contexts/SyncContext"
import { useWindowCheck } from "@/hooks/useWindowCheck"
import { setBannerSync, useBannerSync } from "@/lib/complete-window/banner-sync"
import {
  incompleteOf,
  type WindowCheck,
} from "@/lib/complete-window/window-check"
import { WindowBanner } from "./WindowBanner"

/**
 * Sync every Channel a sync can fix, from the banner, before any action. It
 * shortens the action's own sync and never replaces it.
 */
function SyncNow({ check }: { check: WindowCheck }) {
  const running = useBannerSync()
  const { channels } = useData()
  const { scrapeChannelsInParallel } = useSync()
  if (running)
    return (
      <span className="inline-flex items-center gap-1 text-[12px]">
        <Loader2 size={12} className="animate-spin" /> Syncing{" "}
        {running.names.size}…
      </span>
    )
  const fixable = new Set(
    incompleteOf(check)
      .filter((c) => c.syncable)
      .map((c) => c.name),
  )
  const targets = channels.filter((c) => fixable.has(c.name))
  if (targets.length === 0) return null
  const start = async () => {
    setBannerSync({
      names: new Set(targets.map((c) => c.name)),
      startedAt: Date.now(),
    })
    try {
      await scrapeChannelsInParallel(targets, "Complete window sync")
      toast.success(`Synced ${targets.length}. Checking the window again.`)
    } catch {
      toast.error("The sync stopped. Checking the window again.")
    } finally {
      // The sync's own end refetches every Posts read, this check included.
      setBannerSync(null)
    }
  }
  return (
    <TgButton
      type="button"
      size="sm"
      variant="secondary"
      onClick={() => void start()}
    >
      <RefreshCw size={12} />
      Sync {targets.length}
    </TgButton>
  )
}

/**
 * The live check for the current Scope, on the Action tab (a row of its own
 * under the header) and the Posts tab. Never syncs by itself.
 */
export function LiveWindowBanner({ where }: { where: "action" | "posts" }) {
  const { selectedChannels } = useData()
  const { data, updating } = useWindowCheck([...selectedChannels])
  if (selectedChannels.size === 0) return null
  const pad =
    where === "action" ? "border-b border-app-ink/10 px-4 py-2" : "mb-3"
  return (
    <div className={pad}>
      {data ? (
        <WindowBanner
          check={data}
          updating={updating}
          action={<SyncNow check={data} />}
        />
      ) : (
        <span className="flex items-center gap-1 text-[11px] text-app-ink/50">
          <Loader2 size={12} className="animate-spin" /> Checking the window…
        </span>
      )}
    </div>
  )
}

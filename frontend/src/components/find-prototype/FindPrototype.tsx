// PROTOTYPE (find-prototype): throwaway, never merge.
// Ways to find a Channel to follow, switchable with ?variant=E|T|Q|G on
// /workspace?tab=find. Reads staging live through backend/scripts/proto_find_api.py
// (Vite proxies /proto to it). Follow is REAL: it runs the same bulk-follow job
// Discover uses, against whichever API the dev server proxies /api to.
import { getRouteApi } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { PrototypeSwitcher } from "@/components/Common/PrototypeSwitcher"
import { useData } from "@/contexts/DataContext"
import { useScraper } from "@/contexts/ScraperContext"
import { FollowCtx, type Via } from "./shared"
import { VariantBrowseTop } from "./VariantBrowseTop"
import { VariantGraph } from "./VariantGraph"
import { VariantTabs } from "./VariantTabs"
import { VariantTyped } from "./VariantTyped"

const workspaceRoute = getRouteApi("/_tg/workspace")

const VARIANTS = [
  { key: "E", name: "Filter: everything in the Directory" },
  { key: "T", name: "Bar: the Channels and Posts tabs' parts" },
  { key: "Q", name: "Bar: a typed query" },
  { key: "G", name: "Graph: channels and their references" },
]

export function FindPrototype() {
  const { variant = "E" } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const { channels } = useData()
  const { followDiscoverChannels } = useScraper()
  const [states, setStates] = useState<
    Map<string, "pending" | "done" | "error">
  >(() => new Map())

  const followed = useMemo(
    () => new Set(channels.map((c) => c.name.toLowerCase())),
    [channels],
  )
  const set = (handle: string, s: "pending" | "done" | "error") =>
    setStates((prev) => new Map(prev).set(handle, s))

  const ctx = useMemo(
    () => ({
      state: (handle: string) =>
        followed.has(handle.toLowerCase()) ? "done" : states.get(handle),
      follow: async (handle: string, via?: Via) => {
        set(handle, "pending")
        try {
          const status = await followDiscoverChannels([
            { name: handle, discoveredVia: via },
          ])
          const result = status?.results.find((r) => r.name === handle)
          if (
            !status ||
            (result && !["added", "skipped"].includes(result.status))
          )
            throw new Error(
              result?.reason ?? result?.error ?? result?.status ?? "no status",
            )
          set(handle, "done")
          toast.success(`Following @${handle}`)
        } catch (err) {
          set(handle, "error")
          toast.error(`Could not follow @${handle}: ${String(err)}`)
        }
      },
      followMany: async (handles: string[]) => {
        const names = handles.filter((h) => !followed.has(h.toLowerCase()))
        if (!names.length) return
        for (const h of names) set(h, "pending")
        try {
          const status = await followDiscoverChannels(
            names.map((name) => ({ name })),
          )
          const byName = new Map(
            (status?.results ?? []).map((r) => [r.name, r]),
          )
          let ok = 0
          const failed: string[] = []
          for (const h of names) {
            const r = byName.get(h)
            if (status && (!r || ["added", "skipped"].includes(r.status))) {
              set(h, "done")
              ok++
            } else {
              set(h, "error")
              failed.push(`@${h}${r?.reason ? ` (${r.reason})` : ""}`)
            }
          }
          if (ok) toast.success(`Following ${ok} channel${ok === 1 ? "" : "s"}`)
          if (failed.length)
            toast.error(
              `Could not follow ${failed.length}: ${failed.join(", ")}`,
            )
        } catch (err) {
          for (const h of names) set(h, "error")
          toast.error(
            `Could not follow ${names.length} channels: ${String(err)}`,
          )
        }
      },
    }),
    [followed, states, followDiscoverChannels],
  )

  const current = VARIANTS.some((v) => v.key === variant) ? variant : "E"
  return (
    <FollowCtx.Provider value={ctx}>
      <div className="mx-auto w-full max-w-none px-4 pb-24">
        {current === "E" && <VariantBrowseTop />}
        {current === "T" && <VariantTabs />}
        {current === "Q" && <VariantTyped />}
        {current === "G" && <VariantGraph />}
      </div>
      <PrototypeSwitcher
        variants={VARIANTS}
        current={current}
        onChange={(key) =>
          navigate({
            search: (prev) => ({ ...prev, variant: key }),
            replace: true,
          })
        }
      />
    </FollowCtx.Provider>
  )
}

// PROTOTYPE, throwaway: picks the control variant named by `?variant=`.
import { getRouteApi } from "@tanstack/react-router"
import type React from "react"
import { toast } from "sonner"
import { PrototypeSwitcher } from "@/components/Common/PrototypeSwitcher"
import type { ChannelControlsProps } from "./types"
import { VariantA } from "./VariantA"

const workspaceRoute = getRouteApi("/_tg/workspace")

export const PROTOTYPE_VARIANTS = [
  { key: "current", name: "Today's bar" },
  { key: "A", name: "Command bar" },
]

const VARIANTS: Record<string, React.FC<ChannelControlsProps>> = {
  A: VariantA,
}

/** The variant key in the URL, or "current". */
export function usePrototypeVariant() {
  const { variant } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const current = variant && variant in VARIANTS ? variant : "current"
  const setVariant = (key: string) =>
    navigate({
      search: (prev) => ({
        ...prev,
        variant: key === "current" ? undefined : key,
      }),
      replace: true,
    })
  return { current, setVariant }
}

/**
 * Every server write is stubbed: the prototype runs against staging, and the
 * question is what the bar looks like, not whether the writes work.
 */
export function stubWrites(p: ChannelControlsProps): ChannelControlsProps {
  const n = p.selectedChannels.size
  const would = (what: string) => () =>
    toast(`Prototype: would ${what}`, { description: "Nothing was sent." })
  return {
    ...p,
    onAddChannel: would(`follow @${p.inlineChannelName.trim()}`),
    onScrapeSelected: would(`sync ${n} selected channels`),
    onScrapeAll: would("sync all channels"),
    onRequestFreeze: would(`freeze ${n} channels`),
    onRequestUnfreeze: would(`unfreeze ${n} channels`),
    onRequestDelete: would(`delete ${n} channels`),
    onApplyMoveToGroup: would(
      `move ${n} channels to ${p.groups.find((g) => g.id === p.bulkTargetGroupId)?.name ?? "?"}`,
    ),
    onBulkAddTag: would(`add tag "${p.bulkTagInput}" to ${n} channels`),
    onBulkRemoveTag: would(
      `remove tag "${p.bulkRemoveTagInput}" from ${n} channels`,
    ),
  }
}

export const PrototypeControls: React.FC<{
  variant: string
  onVariantChange: (key: string) => void
  controls: ChannelControlsProps
}> = ({ variant, onVariantChange, controls }) => {
  const Variant = VARIANTS[variant]
  return (
    <>
      {Variant && <Variant {...stubWrites(controls)} />}
      <PrototypeSwitcher
        variants={PROTOTYPE_VARIANTS}
        current={variant}
        onChange={onVariantChange}
      />
    </>
  )
}

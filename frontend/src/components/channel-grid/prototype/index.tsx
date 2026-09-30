// PROTOTYPE, throwaway: picks the control variant named by `?variant=`.
import { getRouteApi } from "@tanstack/react-router"
import type React from "react"
import { toast } from "sonner"
import { PrototypeSwitcher } from "@/components/Common/PrototypeSwitcher"
import type { ChannelControlsProps } from "./types"
import { type ALayout, VariantA } from "./VariantA"

const workspaceRoute = getRouteApi("/_tg/workspace")

export const PROTOTYPE_VARIANTS = [
  { key: "current", name: "Today's bar" },
  { key: "A", name: "Size + AI in View" },
  { key: "A1", name: "Size switch on row 1, AI pill" },
  { key: "A2", name: "Size + AI toggles on row 2" },
  { key: "A3", name: "Display strip" },
  { key: "A4", name: "Size bar above the grid, AI pill" },
  { key: "A5", name: "Size + layout on row 2, AI pill" },
  { key: "F1", name: "A5 + always-visible follow field" },
  { key: "F2", name: "A5 + search that offers to follow" },
  { key: "F3", name: "A5 + paste many to follow" },
  { key: "F4", name: "A5 + follow row that opens under the bar" },
]

const aVariant = (layout: ALayout): React.FC<ChannelControlsProps> =>
  function AVariant(p) {
    return <VariantA {...p} layout={layout} />
  }

const VARIANTS: Record<string, React.FC<ChannelControlsProps>> = {
  A: VariantA,
  A1: aVariant({ zoom: "row1", ai: "pill" }),
  A2: aVariant({ zoom: "row2", ai: "row2" }),
  A3: aVariant({ zoom: "strip", ai: "strip" }),
  A4: aVariant({ zoom: "gridbar", ai: "pill" }),
  A5: aVariant({ zoom: "row2", ai: "pill", display: "row2" }),
  F1: aVariant({ zoom: "row2", ai: "pill", display: "row2", follow: "inline" }),
  F2: aVariant({
    zoom: "row2",
    ai: "pill",
    display: "row2",
    follow: "omnibox",
  }),
  F3: aVariant({ zoom: "row2", ai: "pill", display: "row2", follow: "bulk" }),
  F4: aVariant({ zoom: "row2", ai: "pill", display: "row2", follow: "row" }),
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
    onFollowNames: (names, groupId) =>
      toast(
        `Prototype: would follow ${names.map((n) => `@${n}`).join(", ")}${
          groupId
            ? ` into ${p.groups.find((g) => g.id === groupId)?.name ?? "?"}`
            : ""
        }`,
        { description: "Nothing was sent." },
      ),
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

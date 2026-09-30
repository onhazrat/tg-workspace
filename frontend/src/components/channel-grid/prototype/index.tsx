// PROTOTYPE, throwaway: picks the control variant named by `?variant=`.
import { getRouteApi } from "@tanstack/react-router"
import type React from "react"
import { toast } from "sonner"
import { PrototypeSwitcher } from "@/components/Common/PrototypeSwitcher"
import type { LogicKind } from "./logic"
import { actedOn } from "./selection"
import type { ChannelControlsProps } from "./types"
import { type ALayout, VariantA } from "./VariantA"

const workspaceRoute = getRouteApi("/_tg/workspace")

export const PROTOTYPE_VARIANTS = [
  { key: "current", name: "Today's bar" },
  { key: "A", name: "Size + AI in View" },
  { key: "A4", name: "Size bar above the grid, AI pill" },
  { key: "A5", name: "Size + layout on row 2, AI pill" },
  { key: "F1", name: "A5 + always-visible follow field" },
  { key: "F3", name: "A5 + paste many to follow, left of search" },
  { key: "N2", name: "F3 + Filters dropdown, active-filters bar" },
  { key: "L3", name: "N2 + every AND / OR is a toggle" },
  { key: "T1", name: "L3 + nested groups: drag blocks" },
  { key: "S1", name: "T1 + Selection menu with Venn legend" },
  { key: "S3", name: "T1 + pick regions of a Venn" },
]

const aVariant = (layout: ALayout): React.FC<ChannelControlsProps> =>
  function AVariant(p) {
    return <VariantA {...p} layout={layout} />
  }

const F3_LAYOUT: ALayout = {
  zoom: "row2",
  ai: "pill",
  display: "row2",
  follow: "bulk",
  followAt: "start",
}

const T1_LAYOUT: ALayout = { ...F3_LAYOUT, numeric: "builder", tree: "blocks" }

const VARIANTS: Record<string, React.FC<ChannelControlsProps>> = {
  A: VariantA,
  A4: aVariant({ zoom: "gridbar", ai: "pill" }),
  A5: aVariant({ zoom: "row2", ai: "pill", display: "row2" }),
  F1: aVariant({ zoom: "row2", ai: "pill", display: "row2", follow: "inline" }),
  F3: aVariant(F3_LAYOUT),
  N2: aVariant({ ...F3_LAYOUT, numeric: "builder" }),
  L3: aVariant({ ...F3_LAYOUT, numeric: "builder" }),
  T1: aVariant(T1_LAYOUT),
  S1: aVariant({ ...T1_LAYOUT, selection: "menu" }),
  S3: aVariant({ ...T1_LAYOUT, selection: "venn" }),
}

/** How a variant combines its filter conditions. */
export const logicKindFor = (variant: string): LogicKind =>
  variant === "L3" ? "connectors" : /^[TS]\d/.test(variant) ? "tree" : "fixed"

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
  // "Only shown" scope: the actions reach the selected channels in view.
  const n = actedOn(p.selectedChannels, p.shownNames, p.selectionScope)
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

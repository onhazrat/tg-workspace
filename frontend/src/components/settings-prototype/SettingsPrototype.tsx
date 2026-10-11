/**
 * PROTOTYPE (settings redesign), throwaway. Two variants of the workspace
 * Settings tab on the existing `?tab=settings` route, switched by `?variant=`:
 * 0 is main unchanged, A is the redesign.
 */
import { getRouteApi } from "@tanstack/react-router"
import type React from "react"
import { PrototypeSwitcher } from "./PrototypeSwitcher"
import { VariantA } from "./VariantA"

const workspaceRoute = getRouteApi("/_tg/workspace")

const VARIANTS = [
  { key: "0", name: "Current (main)" },
  { key: "A", name: "One list (VS Code)" },
]

export const SettingsPrototype: React.FC<{ current: React.ReactNode }> = ({
  current,
}) => {
  const { variant = "0", setting } = workspaceRoute.useSearch()
  const highlightId = setting ?? null
  return (
    <>
      {variant === "A" ? <VariantA highlightId={highlightId} /> : current}
      <PrototypeSwitcher variants={VARIANTS} current={variant} />
    </>
  )
}

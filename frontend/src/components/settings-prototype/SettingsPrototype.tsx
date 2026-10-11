/**
 * PROTOTYPE (settings redesign), throwaway. Variants of the workspace Settings
 * tab on the existing `?tab=settings` route, switched by `?variant=`: 0 is main
 * unchanged, E is the redesign (see `VariantE.tsx`).
 */
import { getRouteApi } from "@tanstack/react-router"
import type React from "react"
import { PrototypeSwitcher } from "./PrototypeSwitcher"
import { VariantE } from "./VariantE"

const workspaceRoute = getRouteApi("/_tg/workspace")

const VARIANTS = [
  { key: "0", name: "Current (main)" },
  {
    key: "E",
    name: "Generated, Configuration merged, tools in System, nested ids",
  },
]

export const SettingsPrototype: React.FC<{ current: React.ReactNode }> = ({
  current,
}) => {
  const { variant = "0", setting } = workspaceRoute.useSearch()
  const highlightId = setting ?? null
  return (
    <>
      {variant === "E" ? <VariantE highlightId={highlightId} /> : current}
      <PrototypeSwitcher variants={VARIANTS} current={variant} />
    </>
  )
}

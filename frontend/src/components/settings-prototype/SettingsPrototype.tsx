/**
 * PROTOTYPE (settings redesign), throwaway. Four variants of the workspace
 * Settings tab on the existing `?tab=settings` route, switched by `?variant=`:
 * 0 is main unchanged, A/B/C are the redesign options.
 */
import { getRouteApi } from "@tanstack/react-router"
import type React from "react"
import { PrototypeSwitcher } from "./PrototypeSwitcher"
import { VariantA } from "./VariantA"
import { VariantB } from "./VariantB"
import { VariantC } from "./VariantC"

const workspaceRoute = getRouteApi("/_tg/workspace")

const VARIANTS = [
  { key: "0", name: "Current (main)" },
  { key: "A", name: "One list (VS Code)" },
  { key: "B", name: "Scope first" },
  { key: "C", name: "Overview + drawer" },
]

export const SettingsPrototype: React.FC<{ current: React.ReactNode }> = ({
  current,
}) => {
  const { variant = "0", setting } = workspaceRoute.useSearch()
  const highlightId = setting ?? null
  return (
    <>
      {variant === "A" ? (
        <VariantA highlightId={highlightId} />
      ) : variant === "B" ? (
        <VariantB />
      ) : variant === "C" ? (
        <VariantC highlightId={highlightId} />
      ) : (
        current
      )}
      <PrototypeSwitcher variants={VARIANTS} current={variant} />
    </>
  )
}

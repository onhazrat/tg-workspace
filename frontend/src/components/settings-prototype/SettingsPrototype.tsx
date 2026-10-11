/**
 * PROTOTYPE (settings redesign), throwaway. Variants of the workspace Settings
 * tab on the existing `?tab=settings` route, switched by `?variant=`: 0 is main
 * unchanged, D and E are the redesign (see `VariantD.tsx`), F to H draw E
 * with the rest of the workspace's primitives (see `app-skins.tsx`).
 */
import { getRouteApi } from "@tanstack/react-router"
import type React from "react"
import { AppSkin, type Skin } from "./app-skins"
import { PrototypeSwitcher } from "./PrototypeSwitcher"
import { VariantD } from "./VariantD"

const workspaceRoute = getRouteApi("/_tg/workspace")

const VARIANTS = [
  { key: "0", name: "Current (main)" },
  { key: "D", name: "Generated, Configuration merged, tools in System" },
  { key: "E", name: "D, with nested VS Code-style ids" },
  { key: "F", name: "E in the app's style: stacked Action-style panels" },
  { key: "G", name: "E in the app's style: navigation panel, one group" },
  { key: "H", name: "E in the app's style: compact cards" },
]

const SKIN: Partial<Record<string, Skin>> = {
  F: "panels",
  G: "rail",
  H: "cards",
}

export const SettingsPrototype: React.FC<{ current: React.ReactNode }> = ({
  current,
}) => {
  const { variant = "0", setting } = workspaceRoute.useSearch()
  const highlightId = setting ?? null
  return (
    <>
      {variant === "D" ? (
        <VariantD highlightId={highlightId} />
      ) : variant === "E" ? (
        <VariantD highlightId={highlightId} nested />
      ) : SKIN[variant] ? (
        <AppSkin skin={SKIN[variant]} highlightId={highlightId} />
      ) : (
        current
      )}
      <PrototypeSwitcher variants={VARIANTS} current={variant} />
    </>
  )
}

/**
 * PROTOTYPE (settings redesign), throwaway. Variants of the workspace Settings
 * tab on the existing `?tab=settings` route, switched by `?variant=`: 0 is main
 * unchanged, D and E are the redesign (see `VariantD.tsx`), F to H restyle
 * its Users page (see `users-variants.tsx`).
 */
import { getRouteApi } from "@tanstack/react-router"
import type React from "react"
import { PrototypeSwitcher } from "./PrototypeSwitcher"
import type { UsersStyle } from "./users-variants"
import { VariantD } from "./VariantD"

const workspaceRoute = getRouteApi("/_tg/workspace")

const VARIANTS = [
  { key: "0", name: "Current (main)" },
  { key: "D", name: "Generated, Configuration merged, tools in System" },
  { key: "E", name: "D, with nested VS Code-style ids" },
  { key: "F", name: "E, Users as setting rows" },
  { key: "G", name: "F, with search, filters and inline approve" },
  { key: "H", name: "E, Users as list and detail" },
]

const USERS: Partial<Record<string, UsersStyle>> = {
  F: "rows",
  G: "filters",
  H: "detail",
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
      ) : variant === "E" || USERS[variant] ? (
        <VariantD highlightId={highlightId} nested users={USERS[variant]} />
      ) : (
        current
      )}
      <PrototypeSwitcher variants={VARIANTS} current={variant} />
    </>
  )
}

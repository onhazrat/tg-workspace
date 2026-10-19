/**
 * PROTOTYPE, throw away. Settings tab variants on `?variant=`:
 * 0 is main's SettingsHub unchanged, A and B are the one-page redesigns.
 */
import { getRouteApi } from "@tanstack/react-router"
import { SettingsHub } from "@/components/SettingsHub"
import { PrototypeSwitcher } from "./PrototypeSwitcher"
import { VariantA } from "./VariantA"
import { VariantB } from "./VariantB"

const VARIANTS = [
  { key: "0", name: "Current" },
  { key: "A", name: "Panels + toolbar" },
  { key: "B", name: "Sticky TOC rail" },
]

const workspaceRoute = getRouteApi("/_tg/")

export function SettingsPrototype() {
  const { variant = "0" } = workspaceRoute.useSearch()
  return (
    <>
      {variant === "A" ? (
        <VariantA />
      ) : variant === "B" ? (
        <VariantB />
      ) : (
        <SettingsHub />
      )}
      <PrototypeSwitcher variants={VARIANTS} />
    </>
  )
}

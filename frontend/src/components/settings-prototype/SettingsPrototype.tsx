// PROTOTYPE: picks the Settings tab variant from `?variant=`. Never merge.
import { getRouteApi } from "@tanstack/react-router"
import type React from "react"
import { useEffect } from "react"
import { PrototypeSwitcher } from "@/components/Common/PrototypeSwitcher"
import { SettingsHub } from "@/components/SettingsHub"
import { useLoadDBStats } from "@/hooks/useDBStats"
import {
  VariantA,
  VariantB,
  VariantC,
  VariantD,
  VariantE,
  VariantF,
} from "./Variants"

const workspaceRoute = getRouteApi("/_tg/workspace")

const VARIANTS: { key: string; name: string; view: React.FC }[] = [
  { key: "0", name: "Current", view: SettingsHub },
  { key: "A", name: "Who it affects", view: VariantA },
  { key: "B", name: "One page", view: VariantB },
  { key: "C", name: "Search first", view: VariantC },
  { key: "D", name: "Tasks", view: VariantD },
  { key: "E", name: "System Settings", view: VariantE },
  { key: "F", name: "E + A + B", view: VariantF },
]

export const SettingsPrototype: React.FC = () => {
  const { variant = "0" } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const loadDBStats = useLoadDBStats()
  const current = VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0]

  // The hub loads table stats per section; the variants need them up front.
  useEffect(() => {
    if (current.key !== "0") void loadDBStats()
  }, [current.key, loadDBStats])

  return (
    <>
      <current.view key={current.key} />
      <PrototypeSwitcher
        variants={VARIANTS}
        current={current.key}
        onChange={(key) =>
          navigate({
            search: (prev) => ({ ...prev, variant: key }),
            replace: true,
          })
        }
      />
    </>
  )
}

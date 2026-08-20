import { Zap } from "lucide-react"
import type React from "react"

import { TgButton } from "@/components/ui/tg-button"
import { TgHeroEmptyState } from "@/components/ui/tg-segmented"
import { useUI } from "@/contexts/UIContext"

/**
 * What a results-only tab shows when there is no result.
 *
 * The four feature tabs render an artifact; they no longer make one. Rather
 * than auto-opening the most recent — which Discover used to do, and which
 * becomes a special case once every artifact is one click away in History —
 * they say where work starts and point at it.
 */
export const GoToActionEmptyState: React.FC<{
  what: string
  description: string
}> = ({ what, description }) => {
  const { setActiveTab } = useUI()
  return (
    <TgHeroEmptyState
      icon={<Zap size={28} className="opacity-40" />}
      title={`No ${what} open`}
      description={description}
    >
      <TgButton
        data-testid="go-to-action"
        onClick={() => setActiveTab("action")}
      >
        Go to Action
      </TgButton>
    </TgHeroEmptyState>
  )
}

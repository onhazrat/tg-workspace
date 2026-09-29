import { Compass } from "lucide-react"
import type React from "react"

import { ActionRow } from "@/components/action/ActionRow"
import { discoverButton } from "@/components/action/action-view-model"
import { TgButton } from "@/components/ui/tg-button"
import { useApiStatus } from "@/hooks/useApiStatus"
import { useDiscoverGenerate } from "@/hooks/useDiscoverGenerate"

/**
 * Generate a Discover report. No controls and no Key: the report is a
 * server-side aggregation with no inference in it.
 */
export const DiscoverAction: React.FC = () => {
  const { isOffline } = useApiStatus()
  const { generate, isGenerating, channelCount } = useDiscoverGenerate()
  const button = discoverButton({ isGenerating, isOffline, channelCount })

  return (
    <ActionRow
      icon={Compass}
      title="Discover channels"
      description="Find the channels your channels keep pointing at."
      primary={
        <TgButton
          data-testid="action-generate-report"
          disabled={button.disabled}
          onClick={() => void generate()}
        >
          <Compass size={13} />
          {button.label}
        </TgButton>
      }
    />
  )
}

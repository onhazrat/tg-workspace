import { Tags } from "lucide-react"
import type React from "react"

import { TgButton } from "@/components/ui/tg-button"
import { useTagContext } from "@/contexts/TagContext"

/**
 * Apply the suggestions currently previewed.
 *
 * Lives on the Tag tab, not on Action, even though every other tag control
 * moved. Apply *confirms what the preview shows* — separating the button from
 * the thing it confirms would be a worse UI than the inconsistency of leaving
 * one control behind. Moving `TagConfig` wholesale took this with it once; the
 * e2e suite is what noticed.
 */
export const ApplyTagsBar: React.FC = () => {
  const { applyCurrentSuggestions, isApplying, suggestions } = useTagContext()
  if (!suggestions || Object.keys(suggestions).length === 0) return null

  return (
    <div className="flex justify-end">
      <TgButton
        type="button"
        variant="secondary"
        size="md"
        onClick={() => void applyCurrentSuggestions()}
        loading={isApplying}
        loadingLabel="Applying…"
        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20"
      >
        <Tags size={13} />
        Apply
      </TgButton>
    </div>
  )
}

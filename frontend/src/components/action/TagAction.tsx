import { ClipboardPaste, Copy, Sparkles, Tag } from "lucide-react"
import type React from "react"
import { useState } from "react"

import {
  ACTION_SWITCH_OPTION_CLASS,
  ActionIconButton,
  ActionRow,
} from "@/components/action/ActionRow"
import { PasteTagsModal } from "@/components/PasteTagsModal"
import { TgButton } from "@/components/ui/tg-button"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { useTagContext } from "@/contexts/TagContext"
import { useSelectedAiKeyId } from "@/hooks/useAiKeys"

type TagMode = ReturnType<typeof useTagContext>["mode"]

/**
 * How to start a tag run: generate here, or copy the prompt and paste the
 * model's answer back through the modal this row owns.
 *
 * No "N channels selected" line: the workspace header already reports the
 * active channel count, and two copies of one number invite the reader to
 * check whether they agree.
 */
export const TagAction: React.FC = () => {
  const {
    mode,
    setMode,
    copyTagPrompt,
    generateTags,
    isGenerating,
    completePendingTagRun,
  } = useTagContext()
  // `/ai/tag/prompt` resolves no Key, so Copy and Paste stay live with none.
  const noKey = useSelectedAiKeyId() === null
  const [pasteOpen, setPasteOpen] = useState(false)

  return (
    <>
      <ActionRow
        icon={Tag}
        title="Tag channels"
        description="Propose tags for the selected channels, then review before applying."
        controls={
          <TgSegmentedControl<TagMode>
            size="sm"
            aria-label="Tag mode"
            value={mode}
            onChange={setMode}
            optionClassName={ACTION_SWITCH_OPTION_CLASS}
            options={[
              { value: "add", label: "Add tags" },
              { value: "remove", label: "Remove tags" },
            ]}
          />
        }
        secondary={
          <>
            <ActionIconButton
              icon={Copy}
              label="Copy tag prompt"
              onClick={() => void copyTagPrompt()}
            />
            <ActionIconButton
              icon={ClipboardPaste}
              label="Paste response"
              hint="Paste a model's answer to the copied tag prompt."
              onClick={() => setPasteOpen(true)}
            />
          </>
        }
        primary={
          <TgButton
            onClick={() => void generateTags()}
            disabled={noKey}
            title={noKey ? "Add an AI key above to run this." : undefined}
            loading={isGenerating}
            loadingLabel="Generating…"
          >
            <Sparkles size={13} />
            Generate tags
          </TgButton>
        }
      />
      <PasteTagsModal
        isOpen={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onSave={completePendingTagRun}
      />
    </>
  )
}

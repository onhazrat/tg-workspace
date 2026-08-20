import { ClipboardPaste, Copy, Sparkles } from "lucide-react"
import type React from "react"
import { TgButton } from "@/components/ui/tg-button"
import { useTagContext } from "@/contexts/TagContext"

interface TagConfigProps {
  onPasteClick: () => void
}

/**
 * How to start a tag run.
 *
 * The "N channels selected" line that used to sit under the mode toggle is
 * gone: the workspace header already reports the active channel count, and two
 * copies of one number invite the reader to check whether they agree.
 */
export const TagConfig: React.FC<TagConfigProps> = ({ onPasteClick }) => {
  const { mode, setMode, copyTagPrompt, generateTags, isGenerating } =
    useTagContext()

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-col gap-2">
        <div className="text-[11px] font-bold uppercase tracking-widest text-app-ink/60">
          Tag Operation Mode
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode("add")}
            className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wide ${
              mode === "add"
                ? "bg-app-ink text-app-bg"
                : "border border-app-ink/15 hover:bg-app-muted/30"
            }`}
          >
            Suggest tags to add
          </button>
          <button
            type="button"
            onClick={() => setMode("remove")}
            className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wide ${
              mode === "remove"
                ? "bg-app-ink text-app-bg"
                : "border border-app-ink/15 hover:bg-app-muted/30"
            }`}
          >
            Suggest tags to remove
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TgButton
          type="button"
          variant="secondary"
          size="md"
          onClick={() => void copyTagPrompt()}
        >
          <Copy size={13} />
          Copy Tag Prompt
        </TgButton>
        <TgButton
          type="button"
          variant="primary"
          size="md"
          onClick={() => void generateTags()}
          loading={isGenerating}
          loadingLabel="Generating..."
        >
          <Sparkles size={13} />
          Generate Tags
        </TgButton>
        <TgButton
          type="button"
          variant="secondary"
          size="md"
          onClick={onPasteClick}
        >
          <ClipboardPaste size={13} />
          Paste Response
        </TgButton>
      </div>
    </div>
  )
}

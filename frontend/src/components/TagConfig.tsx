import { ClipboardPaste, Copy, Sparkles, Tags } from "lucide-react"
import type React from "react"
import { useData } from "@/contexts/DataContext"
import { useTagContext } from "@/contexts/TagContext"

interface TagConfigProps {
  onPasteClick: () => void
}

export const TagConfig: React.FC<TagConfigProps> = ({ onPasteClick }) => {
  const { selectedChannels } = useData()
  const { mode, setMode, copyTagPrompt, generateTags, applyCurrentSuggestions, isGenerating } =
    useTagContext()

  const selectedCount = selectedChannels.size
  const batchCount = selectedCount === 0 ? 0 : Math.ceil(selectedCount / 12)

  return (
    <div className="rounded-xl border border-app-ink/10 bg-app-card p-4 shadow-sm">
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
          <div className="text-xs text-app-ink/70">
            {selectedCount} selected channel(s) - {batchCount} batch(es)
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void copyTagPrompt()}
            className="flex items-center gap-2 rounded-lg border border-app-ink/15 px-3 py-2 text-xs font-bold uppercase tracking-wide hover:bg-app-muted/30"
          >
            <Copy size={13} />
            Copy Prompt
          </button>
          <button
            type="button"
            onClick={() => void generateTags()}
            disabled={isGenerating}
            className="flex items-center gap-2 rounded-lg bg-app-ink px-3 py-2 text-xs font-bold uppercase tracking-wide text-app-bg disabled:opacity-50"
          >
            <Sparkles size={13} />
            {isGenerating ? "Generating..." : "Generate Tags"}
          </button>
          <button
            type="button"
            onClick={onPasteClick}
            className="flex items-center gap-2 rounded-lg border border-app-ink/15 px-3 py-2 text-xs font-bold uppercase tracking-wide hover:bg-app-muted/30"
          >
            <ClipboardPaste size={13} />
            Paste Response
          </button>
          <button
            type="button"
            onClick={() => void applyCurrentSuggestions()}
            className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-emerald-700 hover:bg-emerald-500/20"
          >
            <Tags size={13} />
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}

import { StickyNote } from "lucide-react"
import { motion } from "motion/react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"

/**
 * The sticky note under a summary: the editor while `editing`, else the saved
 * note, else nothing. The draft starts from the saved note each time the editor
 * opens, because the editor mounts fresh.
 */
export function SummaryNote({
  note,
  editing,
  onEditingChange,
  onSave,
  onDelete,
}: {
  note: string | undefined
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onSave: (note: string) => void
  onDelete: () => void
}) {
  if (editing)
    return (
      <div className="mt-8">
        <NoteEditor
          initial={note ?? ""}
          canDelete={Boolean(note)}
          onCancel={() => onEditingChange(false)}
          onSave={onSave}
          onDelete={onDelete}
        />
      </div>
    )
  if (!note) return null
  return (
    <div className="mt-8">
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 bg-gradient-to-br from-[#fef08a]/90 to-[#fde047]/90 rounded-sm shadow-sm cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all relative overflow-hidden group"
        onClick={() => onEditingChange(true)}
      >
        {/* Fold effect top right */}
        <div className="absolute top-0 right-0 w-6 h-6 bg-gradient-to-bl from-transparent via-transparent to-[rgba(0,0,0,0.05)] rounded-bl-lg transition-all group-hover:w-8 group-hover:h-8" />

        <div className="flex justify-between items-start mb-2">
          <span className="font-bold uppercase text-[11px] tracking-wider text-amber-800/80 flex items-center gap-1.5">
            <StickyNote size={12} className="text-amber-700/50" />
            Note
          </span>
          <span className="opacity-0 group-hover:opacity-100 text-[11px] font-medium text-amber-700/80 transition-opacity bg-amber-500/10 px-2 py-0.5 rounded-full">
            Edit
          </span>
        </div>
        <p className="text-[13px] font-medium text-amber-950 whitespace-pre-wrap leading-relaxed">
          {note}
        </p>
      </motion.div>
    </div>
  )
}

function NoteEditor({
  initial,
  canDelete,
  onCancel,
  onSave,
  onDelete,
}: {
  initial: string
  canDelete: boolean
  onCancel: () => void
  onSave: (note: string) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(initial)
  return (
    <motion.div
      initial={{ opacity: 0, y: -10, rotate: -1 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      exit={{ opacity: 0, y: -10, rotate: 1 }}
      className="p-4 bg-gradient-to-br from-[#fef08a] to-[#fde047] rounded-sm shadow-[2px_4px_12px_rgba(0,0,0,0.08)] relative overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Fold effect top right */}
      <div className="absolute top-0 right-0 w-6 h-6 bg-gradient-to-bl from-transparent via-transparent to-[rgba(0,0,0,0.05)] rounded-bl-lg" />

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onInput={(e) => {
          const target = e.currentTarget
          target.style.height = "auto"
          target.style.height = `${target.scrollHeight}px`
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(draft)
          else if (e.key === "Escape") onCancel()
        }}
        placeholder="Jot down your thoughts... (Cmd+Enter to save)"
        className="w-full bg-transparent border-none text-[13px] font-medium text-amber-950 placeholder:text-amber-900/40 focus:outline-none resize-none min-h-[80px] leading-relaxed"
      />
      <div className="flex justify-between items-center mt-3 pt-2 border-t border-amber-500/20">
        <span className="text-[11px] text-amber-700/80 font-medium">
          {draft.length} chars
        </span>
        <div className="flex gap-2 items-center">
          {canDelete && (
            <TgButton
              type="button"
              variant="dangerSoft"
              size="sm"
              onClick={onDelete}
              className="mr-1 border-0 bg-transparent hover:bg-red-500/10"
            >
              Delete
            </TgButton>
          )}
          <TgButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-amber-800/80 hover:text-amber-900 hover:bg-amber-500/10"
          >
            Cancel
          </TgButton>
          <TgButton
            type="button"
            variant="primary"
            size="sm"
            onClick={() => onSave(draft)}
            className="bg-amber-900 hover:bg-amber-950 hover:opacity-100 text-amber-50 shadow-sm"
          >
            Save Note
          </TgButton>
        </div>
      </div>
    </motion.div>
  )
}

import { History, Trash2 } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useMemo, useState } from "react"
import { normalizeParsedTagSuggestions } from "@/lib/channels/apply-tag-suggestions"
import { getTagNames } from "@/lib/channels/channel-tag-model"
import { useData } from "../contexts/DataContext"
import { useTagContext } from "../contexts/TagContext"
import { PasteTagsModal } from "./PasteTagsModal"
import { TagConfig } from "./TagConfig"
import { TgIconButton } from "./ui/tg-icon-button"

export const TagView: React.FC = () => {
  const { channels } = useData()
  const {
    mode,
    suggestions,
    tagRuns,
    currentRunId,
    setCurrentRunId,
    completePendingTagRun,
    deleteRun,
    selectedRun,
  } = useTagContext()
  const [pasteOpen, setPasteOpen] = useState(false)

  const previewMode = selectedRun?.mode ?? mode

  const normalizedSuggestions = useMemo(
    () => normalizeParsedTagSuggestions(suggestions, channels),
    [channels, suggestions],
  )

  const rows = useMemo(() => {
    return channels
      .filter((channel) => channel.name in normalizedSuggestions)
      .map((channel) => {
        const currentTags = getTagNames(channel.tags)
        const proposed = normalizedSuggestions[channel.name] ?? []
        const toApply =
          previewMode === "add"
            ? proposed.filter(
                (tag) =>
                  !currentTags.some(
                    (current) => current.toLowerCase() === tag.toLowerCase(),
                  ),
              )
            : proposed.filter((tag) =>
                currentTags.some(
                  (current) => current.toLowerCase() === tag.toLowerCase(),
                ),
              )
        return { channel: channel.name, currentTags, proposed, toApply }
      })
  }, [channels, normalizedSuggestions, previewMode])

  return (
    <motion.div
      key="tag"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <TagConfig onPasteClick={() => setPasteOpen(true)} />

      <div className="rounded-xl border border-app-ink/10 bg-app-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-app-ink/70">
          Preview
          {rows.length > 0 ? (
            <span className="ml-2 font-normal normal-case tracking-normal text-app-ink/60">
              ({rows.length} channel{rows.length === 1 ? "" : "s"})
            </span>
          ) : null}
        </h3>
        {rows.length === 0 ? (
          <p className="text-sm text-app-ink/60">
            Generate or paste tag suggestions to preview changes.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-app-ink/50">
                <tr>
                  <th className="pb-2">Channel</th>
                  <th className="pb-2">Current Tags</th>
                  <th className="pb-2">Proposed</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.channel} className="border-t border-app-ink/10">
                    <td className="py-2 font-mono">@{row.channel}</td>
                    <td className="py-2">
                      {row.currentTags.join(", ") || "—"}
                    </td>
                    <td className="py-2">{row.proposed.join(", ") || "—"}</td>
                    <td className="py-2">
                      {row.toApply.length === 0
                        ? "No changes"
                        : row.toApply
                            .map((tag) =>
                              previewMode === "add" ? `+${tag}` : `-${tag}`,
                            )
                            .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-app-ink/10 bg-app-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-app-ink/70">
          <History size={14} />
          Tag History
        </div>
        {tagRuns.length === 0 ? (
          <p className="text-sm text-app-ink/60">No tag runs yet.</p>
        ) : (
          <div className="space-y-2">
            {tagRuns.map((run) => (
              <div
                key={run.id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                  currentRunId === run.id
                    ? "border-app-ink/30 bg-app-muted/20"
                    : "border-app-ink/10"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setCurrentRunId(run.id)}
                  className="text-left"
                >
                  <div className="text-xs font-bold uppercase tracking-wider text-app-ink">
                    {run.mode === "add" ? "Add mode" : "Remove mode"} •{" "}
                    {run.status}
                  </div>
                  <div className="text-xs text-app-ink/60">
                    {run.channels.length} channels •{" "}
                    {new Date(run.createdAt).toLocaleString()}
                  </div>
                </button>
                <TgIconButton
                  aria-label="Delete tag run"
                  tooltip="Delete tag run"
                  onClick={() => void deleteRun(run.id)}
                  className="hover:text-red-500 hover:bg-app-muted/30"
                >
                  <Trash2 size={14} />
                </TgIconButton>
              </div>
            ))}
          </div>
        )}
        {selectedRun?.promptText ? (
          <pre className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-app-ink/10 bg-app-muted/10 p-3 text-xs font-mono text-app-ink/80">
            {selectedRun.promptText}
          </pre>
        ) : null}
      </div>

      <PasteTagsModal
        isOpen={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onSave={completePendingTagRun}
      />
    </motion.div>
  )
}

import { motion } from "motion/react"
import type React from "react"
import { useMemo } from "react"
import { ArtifactScopeLine } from "@/components/ArtifactScopeLine"
import { GoToActionEmptyState } from "@/components/history/GoToActionEmptyState"
import { ApplyTagsBar } from "@/components/tag/ApplyTagsBar"
import { TagViewBody } from "@/components/tag/TagViewBody"
import { normalizeParsedTagSuggestions } from "@/lib/channels/apply-tag-suggestions"
import { getTagNames } from "@/lib/channels/channel-tag-model"
import { useData } from "../contexts/DataContext"

import { useTagContext } from "../contexts/TagContext"

export const TagView: React.FC = () => {
  const { channels, selectedChannels } = useData()
  const { mode, suggestions, selectedRun } = useTagContext()

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
      <ApplyTagsBar />
      <TagViewBody
        rows={rows}
        previewMode={previewMode}
        selectedCount={selectedChannels.size}
        selectedRun={selectedRun}
        scopeLine={(run) => <ArtifactScopeLine artifact={run} />}
        emptyState={
          <GoToActionEmptyState
            what="tag run"
            description="Tag runs are saved with the channels they were made for. Open one from History, or start a new one."
          />
        }
      />
    </motion.div>
  )
}

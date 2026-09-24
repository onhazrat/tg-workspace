import { Plus, X } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  addManualTag,
  normalizeChannelTags,
  removeTagsByName,
} from "@/lib/channels/channel-tag-model"
import { isVirtualGroupTag } from "@/lib/channels/virtual-group-tags"
import type { Channel } from "@/types"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tg-tooltip"

type Tags = NonNullable<Channel["tags"]>

export function ChannelCardTags({
  tags,
  virtualGroupTagName,
  inheritedSettingsHint,
  onSave,
}: {
  tags: Channel["tags"]
  virtualGroupTagName: string | null
  inheritedSettingsHint: string
  onSave: (tags: Tags) => void
}) {
  const [isAdding, setIsAdding] = useState(false)

  const commit = (raw: string) => {
    setIsAdding(false)
    const tag = raw.trim()
    if (!tag) return
    if (isVirtualGroupTag(tag)) {
      toast.error('Tags starting with "group:" are reserved for setting groups')
      return
    }
    onSave(addManualTag(tags, tag))
  }

  return (
    <div className="mb-5 flex flex-wrap gap-1.5">
      {virtualGroupTagName && (
        <span
          className="text-[10px] font-bold px-2 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 rounded-md"
          title={inheritedSettingsHint}
        >
          {virtualGroupTagName}
        </span>
      )}
      {normalizeChannelTags(tags).map((tag) => (
        <span
          key={tag.name.toLowerCase()}
          className="text-[10px] font-bold px-2 py-1 bg-app-ink/5 border border-app-ink/10 flex items-center gap-1.5 group/tag rounded-md text-app-ink/80"
        >
          {tag.name}
          {tag.source === "ai" && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500/80" />
          )}
          <button
            type="button"
            aria-label={`Remove tag ${tag.name}`}
            onClick={(e) => {
              e.stopPropagation()
              onSave(removeTagsByName(tags, [tag.name]))
            }}
            className="opacity-0 group-hover/tag:opacity-50 hover:!opacity-100 focus-visible:!opacity-100 transition-opacity"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      {isAdding ? (
        <input
          type="text"
          placeholder="Tag..."
          className="text-[10px] font-bold px-2 py-1 bg-app-bg border border-app-ink/20 focus:border-app-ink/40 focus:outline-none w-20 rounded-md shadow-inner"
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(e.currentTarget.value)
            if (e.key === "Escape") setIsAdding(false)
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setIsAdding(true)
              }}
              className="text-[10px] uppercase font-bold px-2 py-1 border border-dashed border-app-ink/20 text-app-ink/60 hover:text-app-ink hover:border-solid hover:bg-app-ink/5 transition-all flex items-center gap-1 rounded-md"
            >
              <Plus size={10} /> Add Tag
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Add a new tag to this channel</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

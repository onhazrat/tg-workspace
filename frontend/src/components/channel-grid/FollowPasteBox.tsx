import { Plus } from "lucide-react"
import { useState } from "react"
import type { FollowJobStatus } from "@/api"
import { pillClass } from "@/components/PostFilterParts"
import { TgButton } from "@/components/ui/tg-button"
import {
  type PastedHandle,
  parsePastedHandles,
} from "@/lib/channels/paste-handles"
import type { ChannelSettingGroup } from "@/types"
import { BarHeading, BarPopover } from "./BarPopover"

export type FollowPasteBoxProps = {
  /** The names of the Channels already followed. */
  followed: string[]
  settingGroups: ChannelSettingGroup[]
  /** Runs the bulk-follow job; resolves when it is done. */
  onFollow: (
    handles: string[],
    settingGroupId: string | undefined,
    onProgress: (status: FollowJobStatus) => void,
  ) => Promise<unknown>
}

const STATUS_TEXT: Record<PastedHandle["status"], string> = {
  new: "will follow",
  following: "already following",
  invalid: "not a handle",
}

const STATUS_CLASS: Record<PastedHandle["status"], string> = {
  new: "text-green-600",
  following: "text-app-ink/50",
  invalid: "text-red-500",
}

/**
 * Follow at the start of row 1 (CTB-05): paste any number of handles or t.me
 * links, see each one's fate, and follow the new ones into a Setting group in
 * one click. One handle or many, it is the bulk-follow job either way.
 */
export function FollowPasteBox({
  followed,
  settingGroups,
  onFollow,
}: FollowPasteBoxProps) {
  const [text, setText] = useState("")
  const [pickedGroupId, setPickedGroupId] = useState<string>()
  const [progress, setProgress] = useState<FollowJobStatus | null>(null)
  const [running, setRunning] = useState(false)
  const groupId =
    pickedGroupId ??
    (settingGroups.find((group) => group.isDefault) ?? settingGroups[0])?.id
  const parsed = parsePastedHandles(text, followed)
  const fresh = parsed.filter((p) => p.status === "new").map((p) => p.handle)

  const follow = async () => {
    setRunning(true)
    try {
      await onFollow(fresh, groupId, setProgress)
      setText("")
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  return (
    <BarPopover
      width="w-96"
      trigger={
        <button
          type="button"
          id="tour-add-channel"
          className={pillClass(false)}
        >
          <Plus size={12} /> Follow
        </button>
      }
    >
      <BarHeading>
        Handles or t.me links, separated by lines, spaces or commas
      </BarHeading>
      <textarea
        // biome-ignore lint/a11y/noAutofocus: the popover opens to paste into.
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Handles to follow"
        placeholder={"@durov\nhttps://t.me/telegram\nt.me/s/bbcpersian"}
        rows={4}
        className="w-full resize-y rounded-lg border border-app-ink/15 bg-app-muted p-2 font-mono text-[11px] outline-none focus:border-app-ink/40"
      />
      {parsed.length > 0 && (
        <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto px-1">
          {parsed.map((p) => (
            <li
              key={p.handle.toLowerCase()}
              data-testid="follow-paste-row"
              className={`text-[11px] font-semibold ${STATUS_CLASS[p.status]}`}
            >
              @{p.handle} · {STATUS_TEXT[p.status]}
            </li>
          ))}
        </ul>
      )}
      {progress && (
        <p
          data-testid="follow-paste-progress"
          className="mt-1 px-1 text-[11px] text-app-ink/60"
        >
          Following… {progress.completed} of {progress.total} done
        </p>
      )}
      <div className="mt-2 flex items-center gap-2 px-1 text-[11px] font-semibold">
        into
        <select
          aria-label="Setting group"
          value={groupId ?? ""}
          onChange={(e) => setPickedGroupId(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-app-ink/15 bg-app-card px-2 text-[11px]"
        >
          {settingGroups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
              {group.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
        <TgButton
          size="sm"
          data-testid="follow-paste-submit"
          disabled={fresh.length === 0 || running}
          onClick={() => void follow()}
        >
          Follow {fresh.length}
        </TgButton>
      </div>
    </BarPopover>
  )
}

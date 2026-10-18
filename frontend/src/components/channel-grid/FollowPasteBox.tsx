import { Plus } from "lucide-react"
import { useState } from "react"
import type { FollowJobStatus } from "@/api"
import { HandlePasteBox } from "@/components/HandlePasteBox"
import { pillClass } from "@/components/PostFilterParts"
import type { PastedHandle } from "@/lib/channels/paste-handles"
import type { ChannelSettingGroup } from "@/types"

export type FollowPasteBoxProps = {
  /** The names of the Channels already followed. */
  followed: string[]
  settingGroups: ChannelSettingGroup[]
  /** Runs the bulk-follow job; resolves to its last status, or null if it never ran. */
  onFollow: (
    handles: string[],
    settingGroupId: string | undefined,
    onProgress: (status: FollowJobStatus) => void,
  ) => Promise<FollowJobStatus | null>
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
  const [pickedGroupId, setPickedGroupId] = useState<string>()
  const [progress, setProgress] = useState<FollowJobStatus | null>(null)
  const groupId =
    pickedGroupId ??
    (settingGroups.find((group) => group.isDefault) ?? settingGroups[0])?.id

  const follow = async (rows: PastedHandle[]) => {
    const handles = rows.filter((r) => r.status === "new").map((r) => r.handle)
    try {
      // A follow that never ran (offline, a refused request) keeps the paste.
      return (await onFollow(handles, groupId, setProgress)) !== null
    } finally {
      setProgress(null)
    }
  }

  return (
    <HandlePasteBox
      trigger={
        <button
          type="button"
          id="tour-add-channel"
          className={pillClass(false)}
        >
          <Plus size={12} /> Follow
        </button>
      }
      known={followed}
      labels={{
        new: "will follow",
        known: "already following",
        invalid: "not a handle",
      }}
      label="Handles to follow"
      verb="Follow"
      testId="follow-paste"
      onSubmit={follow}
      status={
        progress && (
          <p
            data-testid="follow-paste-progress"
            className="mt-1 px-1 text-[11px] text-app-ink/60"
          >
            Following… {progress.completed} of {progress.total} done
          </p>
        )
      }
      extra={
        <>
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
        </>
      }
    />
  )
}

import { Trash2 } from "lucide-react"
import type { Dispatch, SetStateAction } from "react"

import type { SettingGroupWriteBody } from "@/api"
import { TgButton } from "@/components/ui/tg-button"
import {
  AUTO_SYNC_INTERVAL_MAX_MINUTES,
  AUTO_SYNC_INTERVAL_MIN_MINUTES,
} from "@/constants"
import type { ChannelSettingGroup } from "@/types"
import {
  channelCountLabel,
  groupLabel,
  isDeletable,
  mustEmptyBeforeDelete,
  PERMISSION_TOGGLES,
  SYNC_TOGGLES,
  type ToggleKey,
} from "./setting-groups-model"

/** The props-only pieces of `SettingGroupsPanel`; the shell keeps the state. */

export type Busy = "save" | "delete" | "create" | null

type SetDraft = Dispatch<SetStateAction<SettingGroupWriteBody>>

export function GroupList({
  groups,
  selectedId,
  onSelect,
}: {
  groups: ChannelSettingGroup[]
  selectedId: string | null
  onSelect: (group: ChannelSettingGroup) => void
}) {
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          onClick={() => onSelect(group)}
          className={`w-full text-left px-3 py-2 rounded-md border text-[11px] transition-all ${
            selectedId === group.id
              ? "border-app-ink bg-app-ink text-app-bg"
              : "border-app-ink/10 hover:border-app-ink/30"
          }`}
        >
          <div className="font-bold uppercase tracking-wide">
            {groupLabel(group)}
          </div>
          <div className="opacity-70 text-[9px] mt-1">
            {channelCountLabel(group)}
          </div>
        </button>
      ))}
    </div>
  )
}

function ToggleRow({
  toggles,
  draft,
  setDraft,
}: {
  toggles: readonly (readonly [ToggleKey, string])[]
  draft: SettingGroupWriteBody
  setDraft: SetDraft
}) {
  return (
    <div className="flex flex-wrap gap-4 text-[10px] uppercase font-bold">
      {toggles.map(([key, label]) => (
        <label key={key} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(draft[key])}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, [key]: e.target.checked }))
            }
          />
          {label}
        </label>
      ))}
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  className,
}: {
  label: string
  value: number
  min: number
  max?: number
  onChange: (value: number) => void
  className: string
}) {
  return (
    <label className={className}>
      <span className="text-[9px] uppercase font-bold opacity-60">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
        className="w-full bg-app-bg border border-app-ink/15 px-2 py-1.5 text-sm"
      />
    </label>
  )
}

export function GroupEditor({
  group,
  draft,
  setDraft,
  busy,
  onSave,
  onDelete,
}: {
  group: ChannelSettingGroup
  draft: SettingGroupWriteBody
  setDraft: SetDraft
  busy: Busy
  onSave: () => void
  onDelete: () => void
}) {
  const deletable = isDeletable(group)
  return (
    <div className="space-y-4 rounded-xl border border-app-ink/10 p-4 bg-app-muted/20">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[9px] uppercase font-bold opacity-60">
            Name
          </span>
          <input
            value={draft.name ?? ""}
            disabled={!deletable}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, name: e.target.value }))
            }
            className="w-full bg-app-bg border border-app-ink/15 px-2 py-1.5 text-sm disabled:opacity-50"
          />
        </label>
        <NumberField
          label="Regular interval (min)"
          value={draft.autoSyncIntervalMinutes ?? 60}
          min={AUTO_SYNC_INTERVAL_MIN_MINUTES}
          max={AUTO_SYNC_INTERVAL_MAX_MINUTES}
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, autoSyncIntervalMinutes: value }))
          }
          className="space-y-1"
        />
      </div>

      <ToggleRow toggles={SYNC_TOGGLES} draft={draft} setDraft={setDraft} />

      <div className="space-y-2">
        <p className="text-[9px] uppercase font-bold opacity-60">
          Sync permissions
        </p>
        <ToggleRow
          toggles={PERMISSION_TOGGLES}
          draft={draft}
          setDraft={setDraft}
        />
        <p className="text-[10px] normal-case opacity-60">
          Bulk sync covers Sync Selected, Fix Partial History, and bulk reset
          eligibility. Individual sync covers card and palette single-channel
          sync.
        </p>
      </div>

      <NumberField
        label="Dynamic expected posts"
        value={draft.dynamicSyncExpectedPosts ?? 15}
        min={1}
        onChange={(value) =>
          setDraft((prev) => ({ ...prev, dynamicSyncExpectedPosts: value }))
        }
        className="space-y-1 block max-w-xs"
      />

      <div className="flex flex-wrap gap-2 pt-2">
        <TgButton
          type="button"
          variant="primary"
          size="md"
          loading={busy === "save"}
          loadingLabel="Save group"
          disabled={busy !== null}
          onClick={onSave}
        >
          Save group
        </TgButton>
        {deletable && (
          <TgButton
            type="button"
            variant="dangerSoft"
            size="md"
            loading={busy === "delete"}
            loadingLabel="Delete"
            disabled={busy !== null}
            onClick={onDelete}
          >
            <Trash2 size={12} />
            Delete
          </TgButton>
        )}
      </div>
      {mustEmptyBeforeDelete(group) && (
        <p className="text-[10px] text-amber-700/80">
          Move all {group.channelCount} channel(s) to another group before
          deleting this one.
        </p>
      )}
    </div>
  )
}

export function CreateGroupForm({
  name,
  onNameChange,
  busy,
  onCreate,
}: {
  name: string | null | undefined
  onNameChange: (name: string) => void
  busy: Busy
  onCreate: () => void
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <input
        value={name ?? ""}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Group name"
        className="flex-1 bg-app-bg border border-app-ink/15 px-3 py-2 text-sm"
      />
      <TgButton
        type="button"
        variant="primary"
        size="md"
        loading={busy === "create"}
        loadingLabel="Create group"
        disabled={busy !== null}
        onClick={onCreate}
      >
        Create group
      </TgButton>
    </div>
  )
}

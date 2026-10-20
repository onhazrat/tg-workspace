/**
 * Setting groups (SET-03): a table whose rows open into an editor under them,
 * and a New group form. The rules are `setting-groups-model`'s, the calls the
 * same `/data/setting-groups` ones the old panel made. A `?settingGroup=` link
 * (the Channels tab writes one) opens that group.
 */
import { ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api, type SettingGroupWriteBody } from "@/api"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import {
  draftFromGroup,
  emptyDraft,
  isDeletable,
  mustEmptyBeforeDelete,
  PERMISSION_TOGGLES,
  SYNC_TOGGLES,
} from "@/components/setting-groups/setting-groups-model"
import { TgButton } from "@/components/ui/tg-button"
import {
  AUTO_SYNC_INTERVAL_MAX_MINUTES,
  AUTO_SYNC_INTERVAL_MIN_MINUTES,
} from "@/constants"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { useWorkspaceGroupParams } from "@/hooks/useWorkspaceGroupParams"
import type { ChannelSettingGroup } from "@/types"
import {
  ConfirmButton,
  cellClass,
  errorOf,
  FormError,
  FormInput,
  FormPill,
  fieldClass,
  ListTable,
  Note,
  rowClass,
} from "./kit"

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | undefined
  onChange: (value: number) => void
}) {
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={value ?? ""}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      onKeyDown={(e) => e.stopPropagation()}
      className={`${fieldClass} w-20 text-right tabular-nums`}
    />
  )
}

function GroupEditor({
  group,
  onSave,
  onDelete,
  onDone,
}: {
  group: ChannelSettingGroup
  onSave: (draft: SettingGroupWriteBody) => Promise<unknown>
  onDelete: () => Promise<unknown>
  onDone: () => void
}) {
  const [draft, setDraft] = useState(() => draftFromGroup(group))
  useEffect(() => setDraft(draftFromGroup(group)), [group])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const deletable = isDeletable(group)
  const save = async () => {
    const minutes = draft.autoSyncIntervalMinutes ?? 0
    if (
      minutes < AUTO_SYNC_INTERVAL_MIN_MINUTES ||
      minutes > AUTO_SYNC_INTERVAL_MAX_MINUTES
    )
      return setError(
        `Sync every ${AUTO_SYNC_INTERVAL_MIN_MINUTES} to ${AUTO_SYNC_INTERVAL_MAX_MINUTES} minutes`,
      )
    setBusy(true)
    setError("")
    try {
      await onSave(draft)
      onDone()
    } catch (e) {
      setError(errorOf(e))
    } finally {
      setBusy(false)
    }
  }
  const toggles = (list: typeof SYNC_TOGGLES) =>
    list.map(([key, label]) => (
      <BarToggle
        key={key}
        on={Boolean(draft[key])}
        label={label}
        title={label}
        onClick={() => setDraft({ ...draft, [key]: !draft[key] })}
      />
    ))
  return (
    <div className="space-y-3 bg-app-ink/[0.03] px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-app-ink/60">
        <span className="flex items-center gap-2">
          Name
          <input
            aria-label="Group name"
            value={draft.name ?? ""}
            disabled={!deletable}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            className={`${fieldClass} w-44`}
          />
        </span>
        <span className="flex items-center gap-2">
          Sync every
          <NumberInput
            label="Sync every (minutes)"
            value={draft.autoSyncIntervalMinutes}
            onChange={(v) => setDraft({ ...draft, autoSyncIntervalMinutes: v })}
          />
          min
        </span>
        <span className="flex items-center gap-2">
          Dynamic sync expects
          <NumberInput
            label="Dynamic sync expected posts"
            value={draft.dynamicSyncExpectedPosts}
            onChange={(v) =>
              setDraft({ ...draft, dynamicSyncExpectedPosts: Math.max(1, v) })
            }
          />
          posts
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">{toggles(SYNC_TOGGLES)}</div>
      <div className="flex flex-wrap gap-1.5">
        {toggles(PERMISSION_TOGGLES)}
      </div>
      <Note>
        Bulk sync covers Sync Selected, Fix Partial History and bulk reset.
        Individual sync covers the card and palette single-channel sync.
      </Note>
      <FormError>{error}</FormError>
      <div className="flex flex-wrap items-center gap-2">
        <TgButton size="sm" loading={busy} onClick={() => void save()}>
          Save group
        </TgButton>
        <TgButton size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </TgButton>
        {mustEmptyBeforeDelete(group) && (
          <Note>
            Move its {group.channelCount} channels to another group before
            deleting it.
          </Note>
        )}
        {deletable && (
          <span className="ml-auto">
            <ConfirmButton
              label={`Delete group ${group.name}`}
              title={`Delete group "${group.name}"?`}
              confirmLabel="Delete"
              onConfirm={onDelete}
            />
          </span>
        )}
      </div>
    </div>
  )
}

function NewGroup({
  onCreate,
}: {
  onCreate: (name: string) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const create = async () => {
    if (!name.trim()) return
    try {
      await onCreate(name.trim())
      setName("")
      setOpen(false)
    } catch (e) {
      setError(errorOf(e))
    }
  }
  return (
    <FormPill
      label="New group"
      heading="Starts with the default rules; edit it after"
      open={open}
      onOpenChange={setOpen}
    >
      <FormInput
        label="New group name"
        placeholder="Group name"
        value={name}
        onChange={setName}
        onEnter={() => void create()}
      />
      <FormError>{error}</FormError>
      <TgButton size="sm" disabled={!name.trim()} onClick={() => void create()}>
        Create group
      </TgButton>
    </FormPill>
  )
}

const onLabels = (g: ChannelSettingGroup) =>
  SYNC_TOGGLES.filter(([key]) => g[key])
    .map(([, label]) => label)
    .join(" · ") || "—"

export function SettingGroupsView({
  groups,
  isLoading,
  openId,
  onOpen,
  onCreate,
  onSave,
  onDelete,
}: {
  groups: ChannelSettingGroup[]
  isLoading: boolean
  openId: string | null
  onOpen: (id: string | null) => void
  onCreate: (name: string) => Promise<unknown>
  onSave: (id: string, draft: SettingGroupWriteBody) => Promise<unknown>
  onDelete: (group: ChannelSettingGroup) => Promise<unknown>
}) {
  return (
    <div className="space-y-2">
      <NewGroup onCreate={onCreate} />
      <ListTable
        testId="setting-groups"
        columns={[
          { label: "Group" },
          { label: "Channels", className: "text-right" },
          { label: "Sync every", className: "text-right" },
          { label: "On" },
        ]}
        isEmpty={!groups.length}
        empty={isLoading ? "Loading…" : "No groups"}
      >
        {groups.flatMap((g) => {
          const open = openId === g.id
          const row = (
            <tr
              key={g.id}
              className={`${rowClass} ${open ? "bg-blue-500/5" : ""}`}
            >
              <td className={cellClass}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => onOpen(open ? null : g.id)}
                  className="inline-flex items-center gap-1 font-semibold"
                >
                  <ChevronRight
                    size={12}
                    className={open ? "rotate-90" : ""}
                    aria-hidden
                  />
                  {g.name}
                  {g.isDefault && (
                    <span className="ml-1 rounded-full bg-app-ink/10 px-1.5 text-[10px] font-normal">
                      default
                    </span>
                  )}
                </button>
              </td>
              <td className={`${cellClass} text-right tabular-nums`}>
                {g.channelCount ?? 0}
              </td>
              <td className={`${cellClass} text-right tabular-nums`}>
                {g.autoSyncIntervalMinutes} min
              </td>
              <td className={`${cellClass} text-app-ink/60`}>{onLabels(g)}</td>
            </tr>
          )
          if (!open) return [row]
          return [
            row,
            <tr key={`${g.id}-edit`} className="border-t border-app-ink/5">
              <td colSpan={4} className="p-0">
                <GroupEditor
                  group={g}
                  onSave={(draft) => onSave(g.id, draft)}
                  onDelete={() => onDelete(g)}
                  onDone={() => onOpen(null)}
                />
              </td>
            </tr>,
          ]
        })}
      </ListTable>
    </div>
  )
}

export function SettingGroups() {
  const { data: groups = [], isLoading } = useSettingGroupsQuery()
  const invalidate = useInvalidateSettingGroups()
  const { selectedSettingGroupId, setSelectedSettingGroup } =
    useWorkspaceGroupParams()
  const open = selectedSettingGroupId || null
  return (
    <SettingGroupsView
      groups={groups}
      isLoading={isLoading}
      openId={open}
      onOpen={(id) => setSelectedSettingGroup(id ?? "")}
      onCreate={async (name) => {
        const created = await api.createSettingGroup({ ...emptyDraft(), name })
        await invalidate()
        toast.success(`Created group "${created.name}"`)
        setSelectedSettingGroup(created.id)
      }}
      onSave={async (id, draft) => {
        await api.updateSettingGroup(id, draft)
        await invalidate()
        toast.success(`Updated group "${draft.name}"`)
      }}
      onDelete={async (group) => {
        await api.deleteSettingGroup(group.id)
        await invalidate()
        toast.success(`Deleted group "${group.name}"`)
        setSelectedSettingGroup("")
      }}
    />
  )
}

import { Layers, Plus, Trash2 } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api, type SettingGroupWriteBody } from "@/api"
import { TgButton } from "@/components/ui/tg-button"
import {
  AUTO_SYNC_INTERVAL_MAX_MINUTES,
  AUTO_SYNC_INTERVAL_MIN_MINUTES,
} from "@/constants"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { useSummarizerGroupParams } from "@/hooks/useSummarizerGroupParams"
import {
  isReservedSettingGroup,
  resolveInitialSelectedGroupId,
} from "@/lib/channels/setting-groups"
import type { ChannelSettingGroup } from "@/types"

const isReservedGroup = isReservedSettingGroup

const emptyDraft = (): SettingGroupWriteBody => ({
  name: "",
  regularSyncEnabled: true,
  dynamicSyncEnabled: false,
  autoSyncIntervalMinutes: 60,
  dynamicSyncExpectedPosts: 15,
  autoFollowForwarded: false,
  isFrozen: false,
  isUnavailableOnWebView: false,
  includeInSyncAll: true,
  includeInBulkSync: true,
  allowIndividualSync: true,
  resetSyncEnabled: true,
})

const draftFromGroup = (group: ChannelSettingGroup): SettingGroupWriteBody => ({
  name: group.name,
  regularSyncEnabled: group.regularSyncEnabled,
  dynamicSyncEnabled: group.dynamicSyncEnabled,
  autoSyncIntervalMinutes: group.autoSyncIntervalMinutes,
  dynamicSyncExpectedPosts: group.dynamicSyncExpectedPosts,
  autoFollowForwarded: group.autoFollowForwarded,
  isFrozen: group.isFrozen,
  isUnavailableOnWebView: group.isUnavailableOnWebView,
  includeInSyncAll: group.includeInSyncAll,
  includeInBulkSync: group.includeInBulkSync,
  allowIndividualSync: group.allowIndividualSync,
  resetSyncEnabled: group.resetSyncEnabled,
})

export const SettingGroupsPanel: React.FC = () => {
  const { selectedSettingGroupId, setSelectedSettingGroup } =
    useSummarizerGroupParams()
  const {
    data: groups = [],
    isLoading,
    isError,
    error,
  } = useSettingGroupsQuery()
  const invalidateSettingGroups = useInvalidateSettingGroups()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SettingGroupWriteBody>(emptyDraft())
  const [createDraft, setCreateDraft] = useState<SettingGroupWriteBody>(
    emptyDraft(),
  )
  const [busy, setBusy] = useState<"save" | "delete" | "create" | null>(null)

  useEffect(() => {
    const nextId = resolveInitialSelectedGroupId(
      groups,
      selectedSettingGroupId,
      selectedId,
    )
    if (nextId !== selectedId) {
      setSelectedId(nextId)
    }
  }, [groups, selectedId, selectedSettingGroupId])

  useEffect(() => {
    const selected = groups.find((group) => group.id === selectedId)
    if (!selected) return
    setDraft(draftFromGroup(selected))
  }, [groups, selectedId])

  useEffect(() => {
    if (!isError) return
    toast.error(
      error instanceof Error ? error.message : "Failed to load setting groups",
    )
  }, [error, isError])

  const selectedGroup = groups.find((group) => group.id === selectedId)
  const showInitialLoading = isLoading && groups.length === 0

  const handleSelectGroup = (group: ChannelSettingGroup) => {
    setSelectedId(group.id)
    setSelectedSettingGroup(group.id)
    setDraft(draftFromGroup(group))
  }

  const handleCreate = async () => {
    if (!createDraft.name?.trim()) {
      toast.error("Group name is required")
      return
    }
    setBusy("create")
    try {
      const created = await api.createSettingGroup(createDraft)
      toast.success(`Created group "${created.name}"`)
      setCreateDraft(emptyDraft())
      await invalidateSettingGroups()
      setSelectedId(created.id)
      setSelectedSettingGroup(created.id)
    } catch (createError) {
      toast.error(
        createError instanceof Error
          ? createError.message
          : "Failed to create setting group",
      )
    } finally {
      setBusy(null)
    }
  }

  const handleSave = async () => {
    if (!selectedId || !selectedGroup) return
    setBusy("save")
    try {
      await api.updateSettingGroup(selectedId, draft)
      toast.success(`Updated group "${draft.name ?? selectedGroup.name}"`)
      await invalidateSettingGroups()
    } catch (saveError) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : "Failed to update setting group",
      )
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async () => {
    if (!selectedId || !selectedGroup || isReservedGroup(selectedGroup)) return
    setBusy("delete")
    try {
      await api.deleteSettingGroup(selectedId)
      toast.success(`Deleted group "${selectedGroup.name}"`)
      setSelectedId(null)
      await invalidateSettingGroups()
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : "Cannot delete group",
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6 pt-6 border-t border-app-ink/5">
      <div className="flex items-center gap-2 opacity-60">
        <Layers size={14} />
        <span className="text-[10px] font-bold uppercase tracking-tight">
          Channel Setting Groups
        </span>
      </div>
      <p className="text-[10px] opacity-40 italic serif">
        Sync and operational settings are inherited from each channel&apos;s
        group. Reassign channels on the Channels tab; edit group defaults here.
      </p>

      {showInitialLoading ? (
        <p className="text-[10px] opacity-50">Loading groups…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-2">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => handleSelectGroup(group)}
                className={`w-full text-left px-3 py-2 rounded-md border text-[11px] transition-all ${
                  selectedId === group.id
                    ? "border-app-ink bg-app-ink text-app-bg"
                    : "border-app-ink/10 hover:border-app-ink/30"
                }`}
              >
                <div className="font-bold uppercase tracking-wide">
                  {group.name}
                  {group.isDefault ? " (default)" : ""}
                </div>
                <div className="opacity-70 text-[9px] mt-1">
                  {group.channelCount ?? 0} channel
                  {(group.channelCount ?? 0) === 1 ? "" : "s"}
                </div>
              </button>
            ))}
          </div>

          {selectedGroup ? (
            <div className="space-y-4 rounded-xl border border-app-ink/10 p-4 bg-app-muted/20">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[9px] uppercase font-bold opacity-60">
                    Name
                  </span>
                  <input
                    value={draft.name ?? ""}
                    disabled={isReservedGroup(selectedGroup)}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="w-full bg-app-bg border border-app-ink/15 px-2 py-1.5 text-sm disabled:opacity-50"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[9px] uppercase font-bold opacity-60">
                    Regular interval (min)
                  </span>
                  <input
                    type="number"
                    min={AUTO_SYNC_INTERVAL_MIN_MINUTES}
                    max={AUTO_SYNC_INTERVAL_MAX_MINUTES}
                    value={draft.autoSyncIntervalMinutes ?? 60}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        autoSyncIntervalMinutes: Number.parseInt(
                          e.target.value,
                          10,
                        ),
                      }))
                    }
                    className="w-full bg-app-bg border border-app-ink/15 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-4 text-[10px] uppercase font-bold">
                {(
                  [
                    ["regularSyncEnabled", "Regular sync"],
                    ["dynamicSyncEnabled", "Dynamic sync"],
                    ["autoFollowForwarded", "Auto-follow"],
                    ["isFrozen", "Frozen"],
                    ["isUnavailableOnWebView", "Restricted"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(draft[key])}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [key]: e.target.checked,
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>

              <div className="space-y-2">
                <p className="text-[9px] uppercase font-bold opacity-60">
                  Sync permissions
                </p>
                <div className="flex flex-wrap gap-4 text-[10px] uppercase font-bold">
                  {(
                    [
                      ["includeInSyncAll", "Include in Sync All"],
                      ["includeInBulkSync", "Include in bulk sync"],
                      ["allowIndividualSync", "Allow individual sync"],
                      ["resetSyncEnabled", "Reset & Sync enabled"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(draft[key])}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [key]: e.target.checked,
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="text-[10px] normal-case opacity-60">
                  Bulk sync covers Sync Selected, Fix Partial History, and bulk
                  reset eligibility. Individual sync covers card and palette
                  single-channel sync.
                </p>
              </div>

              <label className="space-y-1 block max-w-xs">
                <span className="text-[9px] uppercase font-bold opacity-60">
                  Dynamic expected posts
                </span>
                <input
                  type="number"
                  min={1}
                  value={draft.dynamicSyncExpectedPosts ?? 15}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      dynamicSyncExpectedPosts: Number.parseInt(
                        e.target.value,
                        10,
                      ),
                    }))
                  }
                  className="w-full bg-app-bg border border-app-ink/15 px-2 py-1.5 text-sm"
                />
              </label>

              <div className="flex flex-wrap gap-2 pt-2">
                <TgButton
                  type="button"
                  variant="primary"
                  size="md"
                  loading={busy === "save"}
                  loadingLabel="Save group"
                  disabled={busy !== null}
                  onClick={() => void handleSave()}
                >
                  Save group
                </TgButton>
                {!isReservedGroup(selectedGroup) && (
                  <TgButton
                    type="button"
                    variant="dangerSoft"
                    size="md"
                    loading={busy === "delete"}
                    loadingLabel="Delete"
                    disabled={busy !== null}
                    onClick={() => void handleDelete()}
                  >
                    <Trash2 size={12} />
                    Delete
                  </TgButton>
                )}
              </div>
              {!isReservedGroup(selectedGroup) &&
                (selectedGroup.channelCount ?? 0) > 0 && (
                  <p className="text-[10px] text-amber-700/80">
                    Move all {selectedGroup.channelCount} channel(s) to another
                    group before deleting this one.
                  </p>
                )}
            </div>
          ) : null}
        </div>
      )}

      <div className="rounded-xl border border-dashed border-app-ink/15 p-4 space-y-3">
        <div className="flex items-center gap-2 text-[10px] uppercase font-bold opacity-60">
          <Plus size={12} />
          New custom group
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={createDraft.name ?? ""}
            onChange={(e) =>
              setCreateDraft((prev) => ({ ...prev, name: e.target.value }))
            }
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
            onClick={() => void handleCreate()}
          >
            Create group
          </TgButton>
        </div>
      </div>
    </div>
  )
}

import { Layers, Plus, Trash2 } from "lucide-react"
import type React from "react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api, type SettingGroupWriteBody } from "@/api"
import {
  AUTO_SYNC_INTERVAL_MAX_MINUTES,
  AUTO_SYNC_INTERVAL_MIN_MINUTES,
} from "@/constants"
import { isReservedSettingGroup, sortSettingGroupsForDisplay } from "@/lib/channels/setting-groups"
import { useSummarizerGroupParams } from "@/hooks/useSummarizerGroupParams"
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
})

export const SettingGroupsPanel: React.FC = () => {
  const { selectedSettingGroupId, setSelectedSettingGroup } =
    useSummarizerGroupParams()
  const [groups, setGroups] = useState<ChannelSettingGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SettingGroupWriteBody>(emptyDraft())
  const [createDraft, setCreateDraft] = useState<SettingGroupWriteBody>(
    emptyDraft(),
  )
  const [busy, setBusy] = useState(false)

  const loadGroups = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api.listSettingGroups()
      setGroups(sortSettingGroupsForDisplay(rows))
      if (!selectedId && rows.length > 0) {
        const defaultGroup = rows.find((group) => group.isDefault) ?? rows[0]
        setSelectedId(defaultGroup.id)
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load setting groups",
      )
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    void loadGroups()
  }, [loadGroups])

  useEffect(() => {
    if (
      selectedSettingGroupId &&
      groups.some((group) => group.id === selectedSettingGroupId)
    ) {
      setSelectedId(selectedSettingGroupId)
    }
  }, [groups, selectedSettingGroupId])

  useEffect(() => {
    const selected = groups.find((group) => group.id === selectedId)
    if (!selected) return
    setDraft({
      name: selected.name,
      regularSyncEnabled: selected.regularSyncEnabled,
      dynamicSyncEnabled: selected.dynamicSyncEnabled,
      autoSyncIntervalMinutes: selected.autoSyncIntervalMinutes,
      dynamicSyncExpectedPosts: selected.dynamicSyncExpectedPosts,
      autoFollowForwarded: selected.autoFollowForwarded,
      isFrozen: selected.isFrozen,
      isUnavailableOnWebView: selected.isUnavailableOnWebView,
    })
  }, [groups, selectedId])

  const selectedGroup = groups.find((group) => group.id === selectedId)

  const handleCreate = async () => {
    if (!createDraft.name?.trim()) {
      toast.error("Group name is required")
      return
    }
    setBusy(true)
    try {
      const created = await api.createSettingGroup(createDraft)
      toast.success(`Created group "${created.name}"`)
      setCreateDraft(emptyDraft())
      await loadGroups()
      setSelectedId(created.id)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create setting group",
      )
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async () => {
    if (!selectedId || !selectedGroup) return
    setBusy(true)
    try {
      await api.updateSettingGroup(selectedId, draft)
      toast.success(`Updated group "${draft.name ?? selectedGroup.name}"`)
      await loadGroups()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update setting group",
      )
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedId || !selectedGroup || isReservedGroup(selectedGroup)) return
    setBusy(true)
    try {
      await api.deleteSettingGroup(selectedId)
      toast.success(`Deleted group "${selectedGroup.name}"`)
      setSelectedId(null)
      await loadGroups()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Cannot delete group",
      )
    } finally {
      setBusy(false)
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

      {loading ? (
        <p className="text-[10px] opacity-50">Loading groups…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-2">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => {
                  setSelectedId(group.id)
                  setSelectedSettingGroup(group.id)
                }}
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
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSave()}
                  className="px-4 py-2 text-[10px] uppercase font-bold bg-app-ink text-app-bg rounded-md disabled:opacity-40"
                >
                  Save group
                </button>
                {!isReservedGroup(selectedGroup) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDelete()}
                    className="px-4 py-2 text-[10px] uppercase font-bold border border-red-500/30 text-red-600 rounded-md inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
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
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCreate()}
            className="px-4 py-2 text-[10px] uppercase font-bold bg-app-ink text-app-bg rounded-md disabled:opacity-40"
          >
            Create group
          </button>
        </div>
      </div>
    </div>
  )
}

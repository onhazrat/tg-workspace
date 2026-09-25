import { Layers, Plus } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api, type SettingGroupWriteBody } from "@/api"
import { TgHelpText } from "@/components/ui/tg-input"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { useWorkspaceGroupParams } from "@/hooks/useWorkspaceGroupParams"
import { errorText } from "@/lib/artifacts/artifact-run"
import { resolveInitialSelectedGroupId } from "@/lib/channels/setting-groups"
import type { ChannelSettingGroup } from "@/types"
import {
  type Busy,
  CreateGroupForm,
  GroupEditor,
  GroupList,
} from "./setting-groups/SettingGroupsParts"
import {
  draftFromGroup,
  emptyDraft,
  hasName,
  isDeletable,
  savedMessage,
} from "./setting-groups/setting-groups-model"

export const SettingGroupsPanel: React.FC = () => {
  const { selectedSettingGroupId, setSelectedSettingGroup } =
    useWorkspaceGroupParams()
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
  const [busy, setBusy] = useState<Busy>(null)

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
    toast.error(errorText(error, "Failed to load setting groups"))
  }, [error, isError])

  const selectedGroup = groups.find((group) => group.id === selectedId)
  const showInitialLoading = isLoading && groups.length === 0

  const handleSelectGroup = (group: ChannelSettingGroup) => {
    setSelectedId(group.id)
    setSelectedSettingGroup(group.id)
    setDraft(draftFromGroup(group))
  }

  const handleCreate = async () => {
    if (!hasName(createDraft)) {
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
      toast.error(errorText(createError, "Failed to create setting group"))
    } finally {
      setBusy(null)
    }
  }

  const handleSave = async () => {
    if (!selectedId || !selectedGroup) return
    setBusy("save")
    try {
      await api.updateSettingGroup(selectedId, draft)
      toast.success(savedMessage(draft, selectedGroup))
      await invalidateSettingGroups()
    } catch (saveError) {
      toast.error(errorText(saveError, "Failed to update setting group"))
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async () => {
    if (!selectedId || !isDeletable(selectedGroup)) return
    setBusy("delete")
    try {
      await api.deleteSettingGroup(selectedId)
      toast.success(`Deleted group "${selectedGroup.name}"`)
      setSelectedId(null)
      await invalidateSettingGroups()
    } catch (deleteError) {
      toast.error(errorText(deleteError, "Cannot delete group"))
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
      <TgHelpText>
        Sync and operational settings are inherited from each channel&apos;s
        group. Reassign channels on the Channels tab; edit group defaults here.
      </TgHelpText>

      {showInitialLoading ? (
        <p className="text-[10px] opacity-50">Loading groups…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <GroupList
            groups={groups}
            selectedId={selectedId}
            onSelect={handleSelectGroup}
          />
          {selectedGroup ? (
            <GroupEditor
              group={selectedGroup}
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              onSave={() => void handleSave()}
              onDelete={() => void handleDelete()}
            />
          ) : null}
        </div>
      )}

      <div className="rounded-xl border border-dashed border-app-ink/15 p-4 space-y-3">
        <div className="flex items-center gap-2 text-[10px] uppercase font-bold opacity-60">
          <Plus size={12} />
          New custom group
        </div>
        <CreateGroupForm
          name={createDraft.name}
          onNameChange={(name) => setCreateDraft((prev) => ({ ...prev, name }))}
          busy={busy}
          onCreate={() => void handleCreate()}
        />
      </div>
    </div>
  )
}

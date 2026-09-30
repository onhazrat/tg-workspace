import { useEffect, useMemo, useState } from "react"
import { api } from "@/api"
import { useData } from "@/contexts/DataContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useLoadDBStats } from "@/hooks/useDBStats"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { addChannelByName } from "@/lib/channels/add-channel"
import { assignChannelsToSettingGroup } from "@/lib/channels/assign-setting-group"
import {
  addManualTag,
  removeTagsByName,
} from "@/lib/channels/channel-tag-model"
import { deleteChannelByRecord } from "@/lib/channels/delete-channel"
import { findFrozenReservedGroup } from "@/lib/channels/setting-groups"
import { upsertChannel } from "@/lib/channels/store"
import type { Channel } from "@/types"

/**
 * Channel mutations behind the Channels tab: add channel, single/bulk delete,
 * reset-and-sync, bulk freeze/unfreeze, bulk group move, and bulk tag edits,
 * together with the input and confirm-dialog state that drives them.
 *
 * The bulk ones reach `targets`, which is the selection narrowed by the action
 * limit (CTB-04), never the selection itself.
 */
export function useChannelGridActions(targets: ReadonlySet<string>) {
  const { channels, setChannels, setSelectedChannels, loadChannels } = useData()
  const loadDBStats = useLoadDBStats()

  const {
    proxyEnabled,
    defaultProxyUrls,
    torEnabled,
    torMode,
    torProxyUrls,
    torAutoRotate,
    torRotationThreshold,
    getEffectiveGlobalStartTime,
  } = useSettings()

  const { addToSyncQueue } = useScraper()

  const [inlineChannelName, setInlineChannelName] = useState("")
  const [bulkTagInput, setBulkTagInput] = useState("")
  const [bulkRemoveTagInput, setBulkRemoveTagInput] = useState("")
  const [confirmResetModal, setConfirmResetModal] = useState<Channel | null>(
    null,
  )
  const [confirmBulkFreezeAction, setConfirmBulkFreezeAction] = useState<
    "freeze" | "unfreeze" | null
  >(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [confirmDeleteChannel, setConfirmDeleteChannel] =
    useState<Channel | null>(null)
  const { data: settingGroups = [] } = useSettingGroupsQuery()
  const invalidateSettingGroups = useInvalidateSettingGroups()
  const [bulkTargetGroupId, setBulkTargetGroupId] = useState("")

  useEffect(() => {
    const defaultGroup =
      settingGroups.find((group) => group.isDefault) ?? settingGroups[0]
    if (defaultGroup && !bulkTargetGroupId) {
      setBulkTargetGroupId(defaultGroup.id)
    }
  }, [bulkTargetGroupId, settingGroups])

  const targetIds = useMemo(
    () =>
      channels
        .filter((channel) => targets.has(channel.name))
        .map((channel) => channel.id),
    [channels, targets],
  )

  const defaultGroupId = useMemo(
    () => settingGroups.find((group) => group.isDefault)?.id ?? "",
    [settingGroups],
  )

  const frozenGroupId = useMemo(
    () => findFrozenReservedGroup(settingGroups)?.id ?? "",
    [settingGroups],
  )

  const applyBulkGroupAssignment = (settingGroupId: string) =>
    assignChannelsToSettingGroup(targetIds, settingGroupId, {
      settingGroups,
      setChannels,
      loadChannels,
      invalidateSettingGroups,
    })

  const handleRemoveChannel = (channel: Channel) => {
    setConfirmDeleteChannel(channel)
  }

  const executeDeleteChannel = async () => {
    if (!confirmDeleteChannel) return
    await deleteChannelByRecord(confirmDeleteChannel, {
      setSelectedChannels,
      loadChannels,
      loadDBStats,
    })
    setConfirmDeleteChannel(null)
  }

  const handleBulkFreeze = async () => {
    if (!frozenGroupId) return
    await applyBulkGroupAssignment(frozenGroupId)
  }

  const handleBulkUnfreeze = async () => {
    if (!defaultGroupId) return
    await applyBulkGroupAssignment(defaultGroupId)
  }

  const handleConfirmBulkFreezeAction = async () => {
    if (confirmBulkFreezeAction === "freeze") {
      await handleBulkFreeze()
    }
    if (confirmBulkFreezeAction === "unfreeze") {
      await handleBulkUnfreeze()
    }
    setConfirmBulkFreezeAction(null)
  }

  const handleBulkAddTag = async () => {
    if (!bulkTagInput.trim()) return
    const tag = bulkTagInput.trim()
    const updatedChannels = channels.map((c) => {
      if (targets.has(c.name)) {
        const normalizedNewTags = addManualTag(c.tags, tag)
        return { ...c, tags: normalizedNewTags }
      }
      return c
    })
    setChannels(updatedChannels)
    for (const c of updatedChannels) {
      if (targets.has(c.name)) {
        await upsertChannel(c)
      }
    }
    setBulkTagInput("")
  }

  const handleBulkRemoveTag = async () => {
    if (!bulkRemoveTagInput.trim()) return
    const tag = bulkRemoveTagInput.trim()
    const updatedChannels = channels.map((c) => {
      if (targets.has(c.name)) {
        const newTags = removeTagsByName(c.tags, [tag])
        return { ...c, tags: newTags }
      }
      return c
    })
    setChannels(updatedChannels)
    for (const c of updatedChannels) {
      if (targets.has(c.name)) {
        await upsertChannel(c)
      }
    }
    setBulkRemoveTagInput("")
  }

  const executeBulkDelete = async () => {
    for (const name of Array.from(targets)) {
      const channel = channels.find((entry) => entry.name === name)
      if (!channel) continue
      await deleteChannelByRecord(channel, {
        setSelectedChannels,
        loadChannels,
        loadDBStats,
      })
    }
    // The Hidden selection outlives a delete limited to the Shown Channels.
    setSelectedChannels((prev) => {
      const next = new Set(prev)
      for (const name of targets) next.delete(name)
      return next
    })
    setConfirmBulkDelete(false)
  }

  const handleResetAndSync = async (channel: Channel) => {
    setConfirmResetModal(channel)
  }

  const applyBulkMoveToGroup = async () => {
    await applyBulkGroupAssignment(bulkTargetGroupId)
  }

  const executeResetAndSync = async () => {
    if (!confirmResetModal) return
    try {
      await api.bulkResetSync({
        confirm: true,
        channelIds: [confirmResetModal.id],
      })
      await loadChannels()
    } catch (err) {
      console.error("Reset & sync failed:", err)
      addToSyncQueue(confirmResetModal, "Manual (Reset & Sync)", () => {})
    }
    setConfirmResetModal(null)
  }

  const handleAddChannel = async () => {
    if (!inlineChannelName) return
    const result = await addChannelByName(inlineChannelName, {
      channels,
      setSelectedChannels,
      loadChannels,
      addToSyncQueue,
      getEffectiveGlobalStartTime,
      settings: {
        proxyEnabled,
        defaultProxyUrls,
        torEnabled,
        torMode,
        torProxyUrls,
        torAutoRotate,
        torRotationThreshold,
      },
    })
    if (result.ok) setInlineChannelName("")
  }

  return {
    inlineChannelName,
    setInlineChannelName,
    handleAddChannel,
    bulkTagInput,
    setBulkTagInput,
    handleBulkAddTag,
    bulkRemoveTagInput,
    setBulkRemoveTagInput,
    handleBulkRemoveTag,
    bulkTargetGroupId,
    setBulkTargetGroupId,
    applyBulkMoveToGroup,
    confirmResetModal,
    setConfirmResetModal,
    handleResetAndSync,
    executeResetAndSync,
    confirmDeleteChannel,
    setConfirmDeleteChannel,
    handleRemoveChannel,
    executeDeleteChannel,
    confirmBulkDelete,
    setConfirmBulkDelete,
    executeBulkDelete,
    confirmBulkFreezeAction,
    setConfirmBulkFreezeAction,
    handleConfirmBulkFreezeAction,
  }
}

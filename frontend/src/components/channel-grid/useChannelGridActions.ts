import { useEffect, useMemo, useState } from "react"
import { api } from "@/api"
import { useData } from "@/contexts/DataContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { addChannelByName } from "@/lib/channels/add-channel"
import {
  addManualTag,
  removeTagsByName,
} from "@/lib/channels/channel-tag-model"
import { deleteChannelByRecord } from "@/lib/channels/delete-channel"
import {
  findFrozenReservedGroup,
  sortSettingGroupsForDisplay,
} from "@/lib/channels/setting-groups"
import { clearChannelPosts, upsertChannel } from "@/lib/repository"
import type { Channel } from "@/types"

/**
 * Channel mutations behind the Channels tab: add channel, single/bulk delete,
 * reset-and-sync, bulk freeze/unfreeze, bulk group move, and bulk tag edits,
 * together with the input and confirm-dialog state that drives them.
 */
export function useChannelGridActions() {
  const {
    channels,
    setChannels,
    selectedChannels,
    setSelectedChannels,
    loadChannels,
    loadDBStats,
    loadNetworkLogs,
  } = useData()

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

  const sortedSettingGroups = useMemo(
    () => sortSettingGroupsForDisplay(settingGroups),
    [settingGroups],
  )

  const selectedChannelIds = useMemo(
    () =>
      channels
        .filter((channel) => selectedChannels.has(channel.name))
        .map((channel) => channel.id),
    [channels, selectedChannels],
  )

  const defaultGroupId = useMemo(
    () => settingGroups.find((group) => group.isDefault)?.id ?? "",
    [settingGroups],
  )

  const frozenGroupId = useMemo(
    () => findFrozenReservedGroup(settingGroups)?.id ?? "",
    [settingGroups],
  )

  const applyBulkGroupAssignment = async (settingGroupId: string) => {
    if (!settingGroupId || selectedChannelIds.length === 0) return
    await api.bulkAssignSettingGroup({
      channelIds: selectedChannelIds,
      settingGroupId,
    })
    const group = settingGroups.find((item) => item.id === settingGroupId)
    if (!group) {
      await loadChannels()
      return
    }
    setChannels((prev) =>
      prev.map((channel) =>
        selectedChannelIds.includes(channel.id)
          ? {
              ...channel,
              settingGroupId: group.id,
              settingGroupName: group.name,
              regularSyncEnabled: group.regularSyncEnabled,
              dynamicSyncEnabled: group.dynamicSyncEnabled,
              autoSyncIntervalMinutes: group.autoSyncIntervalMinutes,
              dynamicSyncExpectedPosts: group.dynamicSyncExpectedPosts,
              autoFollowForwarded: group.autoFollowForwarded,
              isFrozen: group.isFrozen,
              isUnavailableOnWebView: group.isUnavailableOnWebView,
            }
          : channel,
      ),
    )
    await invalidateSettingGroups()
  }

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
      if (selectedChannels.has(c.name)) {
        const normalizedNewTags = addManualTag(c.tags, tag)
        return { ...c, tags: normalizedNewTags }
      }
      return c
    })
    setChannels(updatedChannels)
    for (const c of updatedChannels) {
      if (selectedChannels.has(c.name)) {
        await upsertChannel(c)
      }
    }
    setBulkTagInput("")
  }

  const handleBulkRemoveTag = async () => {
    if (!bulkRemoveTagInput.trim()) return
    const tag = bulkRemoveTagInput.trim()
    const updatedChannels = channels.map((c) => {
      if (selectedChannels.has(c.name)) {
        const newTags = removeTagsByName(c.tags, [tag])
        return { ...c, tags: newTags }
      }
      return c
    })
    setChannels(updatedChannels)
    for (const c of updatedChannels) {
      if (selectedChannels.has(c.name)) {
        await upsertChannel(c)
      }
    }
    setBulkRemoveTagInput("")
  }

  const executeBulkDelete = async () => {
    for (const name of Array.from(selectedChannels)) {
      const channel = channels.find((entry) => entry.name === name)
      if (!channel) continue
      await deleteChannelByRecord(channel, {
        setSelectedChannels,
        loadChannels,
        loadDBStats,
      })
    }
    setSelectedChannels(new Set())
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
      await clearChannelPosts(confirmResetModal.name)
      await loadChannels()
    } catch (err) {
      console.error("Reset & sync failed:", err)
      await clearChannelPosts(confirmResetModal.name)
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
      loadNetworkLogs,
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
    sortedSettingGroups,
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

import { useEffect, useMemo, useRef, useState } from "react"
import { usePaletteListSelection } from "@/hooks/usePaletteListSelection"
import { removeTagFromChannel } from "@/lib/channels/channel-tags"
import {
  findPostByEntityId,
  getExtendedEntityCandidates,
  isNonChannelEntityFlow,
  isSettingGroupEntityFlow,
} from "@/lib/commands/entity-candidates"
import {
  getChainedEditorField,
  runChainedChannelEntityPick,
} from "@/lib/commands/extended-commands"
import { getStayOpenAnnouncement } from "@/lib/commands/palette-messages"
import {
  filterExtendedEntityCandidates,
  getFirstEntityCandidateId,
} from "@/lib/commands/palette-view-model"
import type { CommandContext, CommandDef } from "@/lib/commands/types"
import {
  filterChannelsByQuery,
  getEntityCandidates,
  runEntityChannelAction,
} from "@/lib/commands/useChannelEntityFlow"
import type { Channel, Post } from "@/types"

interface EntityPaletteControls {
  entityCommand: CommandDef | null
  entityPayload: unknown
  getRootQuery: () => string
  openConfirm: (command: CommandDef, payload?: unknown) => void
  openEditor: (command: CommandDef) => void
  setEntityCommand: (command: CommandDef | null) => void
  close: () => void
  popMode: () => void
}

interface UseEntityFlowOptions {
  open: boolean
  isActive: boolean
  palette: EntityPaletteControls
  context: CommandContext
  recordPick: (query: string, commandId: string) => void
  recordRecent: (commandId: string) => void
  finishCommand: (
    command: CommandDef,
    rootQuery?: string,
    payload?: unknown,
  ) => Promise<void>
  setEditorValue: (value: string) => void
  setLiveAnnouncement: (message: string) => void
}

/** State and behavior for the entity sub-view, including the pick dispatch. */
export function useEntityFlow({
  open,
  isActive,
  palette,
  context,
  recordPick,
  recordRecent,
  finishCommand,
  setEditorValue,
  setLiveAnnouncement,
}: UseEntityFlowOptions) {
  const { entityCommand } = palette
  const [entityQuery, setEntityQuery] = useState("")
  // The post picker's pool, fetched on demand when the pick-post flow opens —
  // the first 100 scoped posts, rather than an eagerly-populated array.
  const [pickPostPool, setPickPostPool] = useState<Post[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const isPickPostFlow = entityCommand?.entityFlow === "pick-post"

  useEffect(() => {
    if (!isPickPostFlow) {
      setPickPostPool([])
      return
    }
    let cancelled = false
    context.getScopedPosts().then((posts) => {
      if (!cancelled) setPickPostPool(posts.slice(0, 100))
    })
    return () => {
      cancelled = true
    }
  }, [isPickPostFlow, context.getScopedPosts])

  const candidates = useMemo(() => {
    if (!entityCommand?.entityFlow) return []
    const flow = entityCommand.entityFlow
    if (flow === "pick-post") {
      const items = pickPostPool.map((post) => ({
        id: `${post.channelName}_${post.id}`,
        label: `@${post.channelName} #${post.id}`,
      }))
      return filterExtendedEntityCandidates(items, entityQuery)
    }
    if (isNonChannelEntityFlow(flow)) {
      const items = getExtendedEntityCandidates(
        flow,
        context,
        palette.entityPayload,
      )
      return filterExtendedEntityCandidates(items, entityQuery)
    }
    const pool = getEntityCandidates(flow, context)
    return filterChannelsByQuery(pool, entityQuery)
  }, [context, entityCommand, entityQuery, palette.entityPayload, pickPostPool])

  const firstEntityId = useMemo(
    () =>
      getFirstEntityCandidateId(
        candidates,
        entityCommand?.entityFlow ?? "search-channel",
      ),
    [candidates, entityCommand?.entityFlow],
  )

  const { selectedId, setSelectedId } = usePaletteListSelection({
    isActive,
    open,
    firstNavigableId: firstEntityId,
    filterKey: entityQuery,
    listRef,
  })

  const finishEntityConfirm = async (
    command: CommandDef,
    payload?: unknown,
  ) => {
    await command.run(context, payload)
    await context.loadChannels()
    palette.popMode()
    setEntityQuery("")
    const flow = entityCommand?.entityFlow
    if (flow) {
      setLiveAnnouncement(getStayOpenAnnouncement(flow))
    }
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  const handlePick = async (value: string) => {
    if (!entityCommand?.entityFlow) return
    const flow = entityCommand.entityFlow

    if (flow === "remove-tag-pick") {
      const channel = palette.entityPayload as Channel | undefined
      if (!channel) return
      await removeTagFromChannel(channel, value, context)
      const rootQuery = palette.getRootQuery()
      if (rootQuery.trim()) {
        recordPick(rootQuery, entityCommand.id)
      }
      recordRecent(entityCommand.id)
      palette.close()
      return
    }

    if (flow === "delete-summary") {
      const summary = context.summariesHistory.find(
        (entry) => entry.id === value,
      )
      if (!summary) return
      if (entityCommand.requiresConfirmation) {
        palette.openConfirm(entityCommand, summary)
        return
      }
      await entityCommand.run(context, summary)
      await finishCommand(entityCommand)
      return
    }

    if (flow === "pick-post") {
      const post = findPostByEntityId(pickPostPool, value)
      if (!post) return
      await entityCommand.run(context, post)
      const rootQuery = palette.getRootQuery()
      if (rootQuery.trim()) {
        recordPick(rootQuery, entityCommand.id)
      }
      recordRecent(entityCommand.id)
      palette.close()
      return
    }

    if (flow === "clear-db-table") {
      if (entityCommand.requiresConfirmation) {
        palette.openConfirm(entityCommand, value)
        return
      }
      await entityCommand.run(context, value)
      await finishCommand(entityCommand)
      return
    }

    if (isSettingGroupEntityFlow(flow)) {
      const group = context.settingGroups.find((entry) => entry.id === value)
      if (!group) return
      await entityCommand.run(context, value)
      await finishCommand(entityCommand)
      return
    }

    const channel = context.channels.find((entry) => entry.name === value)
    if (!channel) return

    if (flow === "delete-channel" && entityCommand.requiresConfirmation) {
      palette.openConfirm(entityCommand, channel)
      return
    }

    if (
      (flow === "reset-sync-channel" ||
        flow === "fix-partial-history-channel") &&
      entityCommand.requiresConfirmation
    ) {
      palette.openConfirm(entityCommand, channel)
      return
    }

    const chained = await runChainedChannelEntityPick(flow, channel, context)
    if (chained === "editor") {
      const field = getChainedEditorField(entityCommand.id, channel)
      setEditorValue(field?.getValue() ?? "")
      palette.openEditor(entityCommand)
      return
    }
    if (chained === "tag-pick") {
      palette.setEntityCommand({
        ...entityCommand,
        entityFlow: "remove-tag-pick",
      })
      setEntityQuery("")
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
      return
    }
    if (chained === "done") {
      const rootQuery = palette.getRootQuery()
      if (rootQuery.trim()) {
        recordPick(rootQuery, entityCommand.id)
      }
      recordRecent(entityCommand.id)
      palette.close()
      return
    }

    await runEntityChannelAction(flow, channel, context)

    const shouldClose = entityCommand.closeOnPick !== false
    if (shouldClose) {
      const rootQuery = palette.getRootQuery()
      if (rootQuery.trim()) {
        recordPick(rootQuery, entityCommand.id)
      }
      recordRecent(entityCommand.id)
      palette.close()
      return
    }

    setEntityQuery("")
    setLiveAnnouncement(getStayOpenAnnouncement(flow))
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  return {
    entityQuery,
    setEntityQuery,
    inputRef,
    candidates,
    selectedId,
    handlePick,
    finishEntityConfirm,
    viewProps: {
      entityQuery,
      onQueryChange: setEntityQuery,
      selectedId,
      onSelectedIdChange: setSelectedId,
      inputRef,
      listRef,
      candidates,
      onPick: handlePick,
    },
  }
}

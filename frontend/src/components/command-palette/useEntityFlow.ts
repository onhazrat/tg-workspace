import { useEffect, useMemo, useRef, useState } from "react"
import { usePaletteListSelection } from "@/hooks/usePaletteListSelection"
import { removeTagFromChannel } from "@/lib/channels/channel-tags"
import {
  getExtendedEntityCandidates,
  isNonChannelEntityFlow,
} from "@/lib/commands/entity-candidates"
import { type PickResolution, resolvePick } from "@/lib/commands/entity-pick"
import {
  getChainedEditorField,
  runChainedChannelEntityPick,
} from "@/lib/commands/extended-commands"
import { getStayOpenAnnouncement } from "@/lib/commands/palette-messages"
import {
  filterExtendedEntityCandidates,
  getFirstEntityCandidateId,
} from "@/lib/commands/palette-view-model"
import type {
  CommandContext,
  CommandDef,
  EntityFlowType,
} from "@/lib/commands/types"
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

  /** Record the pick against the query that led here, then close the palette. */
  const recordAndClose = (command: CommandDef) => {
    const rootQuery = palette.getRootQuery()
    if (rootQuery.trim()) recordPick(rootQuery, command.id)
    recordRecent(command.id)
    palette.close()
  }

  /** Clear the filter and put the cursor back, for a flow that stays open. */
  const refocus = () => {
    setEntityQuery("")
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  /** A channel was picked: chained steps first, then the channel action. */
  const pickChannel = async (
    command: CommandDef,
    flow: EntityFlowType,
    channel: Channel,
  ) => {
    const chained = await runChainedChannelEntityPick(flow, channel, context)
    // A chained step that took over ends the pick here; "confirm" and null
    // fall through to the channel action, as they always have.
    const takeover = {
      editor: () => {
        const field = getChainedEditorField(command.id, channel)
        setEditorValue(field?.getValue() ?? "")
        palette.openEditor(command)
      },
      "tag-pick": () => {
        palette.setEntityCommand({ ...command, entityFlow: "remove-tag-pick" })
        refocus()
      },
      done: () => recordAndClose(command),
    }[chained ?? ""]
    if (takeover) return takeover()

    await runEntityChannelAction(flow, channel, context)
    if (command.closeOnPick !== false) return recordAndClose(command)
    refocus()
    setLiveAnnouncement(getStayOpenAnnouncement(flow))
  }

  const handlePick = async (value: string) => {
    const command = entityCommand
    const flow = command?.entityFlow
    if (!command || !flow) return
    const pick = resolvePick(
      flow,
      value,
      Boolean(command.requiresConfirmation),
      {
        channels: context.channels,
        summaries: context.summariesHistory,
        settingGroups: context.settingGroups,
        posts: pickPostPool,
        payload: palette.entityPayload,
      },
    )
    // One entry per kind, and the mapped type makes a missing one a compile
    // error — which the `switch` this replaced did not.
    const perform: {
      [K in PickResolution["kind"]]: (
        p: Extract<PickResolution, { kind: K }>,
      ) => unknown
    } = {
      ignore: () => undefined,
      confirm: (p) => palette.openConfirm(command, p.payload),
      "run-then-finish": async (p) => {
        await command.run(context, p.payload)
        await finishCommand(command)
      },
      "run-then-close": async (p) => {
        await command.run(context, p.payload)
        recordAndClose(command)
      },
      "remove-tag": async (p) => {
        await removeTagFromChannel(p.channel, p.tag, context)
        recordAndClose(command)
      },
      "finish-with": (p) => finishCommand(command, undefined, p.value),
      channel: (p) => pickChannel(command, flow, p.channel),
    }
    await (perform[pick.kind] as (p: PickResolution) => unknown)(pick)
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

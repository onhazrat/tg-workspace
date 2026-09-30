import {
  ACTION_LIMITS,
  applyRegions,
  isNoop,
  SELECTION_EDITS,
} from "@/lib/channels/selection-regions"
import type { CommandDef } from "@/lib/commands/types"
import {
  runBulkFreezeSelected,
  runBulkUnfreezeSelected,
} from "@/lib/commands/useChannelEntityFlow"

const LIMIT_LABEL = { shown: "Shown", all: "All" } as const

/** The five selection edits and the action limit (CTB-04). */
function buildSelectionCommands(): CommandDef[] {
  return [
    ...SELECTION_EDITS.map(
      (edit): CommandDef => ({
        id: `selection-${edit.key}`,
        kind: "action",
        label: `Selection: ${edit.label}`,
        keywords: ["channels", "selection", "shown", "filter", edit.detail],
        group: "Channels",
        disabled: (ctx) => {
          if (!ctx.shownChannelNames) {
            return { disabled: true, reason: "Open the Channels tab" }
          }
          return isNoop(
            ctx.selectedChannels,
            ctx.shownChannelNames,
            edit.regions,
          )
            ? { disabled: true, reason: "Would change nothing" }
            : { disabled: false }
        },
        run: (ctx) => {
          if (!ctx.shownChannelNames) return
          ctx.setSelectedChannels(
            applyRegions(
              ctx.selectedChannels,
              ctx.shownChannelNames,
              edit.regions,
            ),
          )
        },
      }),
    ),
    ...ACTION_LIMITS.map(
      (limit): CommandDef => ({
        id: `action-limit-${limit}`,
        kind: "action",
        label: `Actions apply to: ${LIMIT_LABEL[limit]}`,
        keywords: ["channels", "selection", "actions", "limit", "hidden"],
        group: "Channels",
        disabled: (ctx) =>
          ctx.settings.channelActionLimit === limit
            ? { disabled: true, reason: `Already on ${LIMIT_LABEL[limit]}` }
            : { disabled: false },
        run: (ctx) => ctx.settings.setChannelActionLimit(limit),
      }),
    ),
  ]
}

export function buildChannelEntityCommands(): CommandDef[] {
  return [
    ...buildSelectionCommands(),
    {
      id: "search-channel",
      kind: "entity-root",
      label: "Search Channel",
      keywords: ["channel", "search", "find", "navigate"],
      group: "Channels",
      entityFlow: "search-channel",
      run: () => {},
    },
    {
      id: "select-channel",
      kind: "entity-root",
      label: "Select Channel",
      keywords: ["channel", "select", "pick"],
      group: "Channels",
      entityFlow: "select-channel",
      closeOnPick: false,
      run: () => {},
    },
    {
      id: "deselect-channel",
      kind: "entity-root",
      label: "Deselect Channel",
      keywords: ["channel", "deselect", "unselect"],
      group: "Channels",
      entityFlow: "deselect-channel",
      closeOnPick: false,
      run: () => {},
    },
    {
      id: "freeze-channel",
      kind: "entity-root",
      label: "Freeze Channel",
      keywords: ["channel", "freeze", "pause"],
      group: "Channels",
      entityFlow: "freeze-channel",
      closeOnPick: false,
      run: () => {},
    },
    {
      id: "unfreeze-channel",
      kind: "entity-root",
      label: "Unfreeze Channel",
      keywords: ["channel", "unfreeze", "resume"],
      group: "Channels",
      entityFlow: "unfreeze-channel",
      closeOnPick: false,
      run: () => {},
    },
    {
      id: "toggle-auto-follow-channel",
      kind: "entity-root",
      label: "Toggle Auto-Follow on Channel",
      keywords: ["channel", "auto-follow", "forward", "discover"],
      group: "Channels",
      entityFlow: "toggle-auto-follow",
      closeOnPick: false,
      run: () => {},
    },
    {
      id: "select-all-channels",
      kind: "action",
      label: "Select All Channels",
      keywords: ["channels", "select", "all"],
      group: "Channels",
      disabled: (ctx) => {
        const selectable = ctx.channels
        if (selectable.length === 0) {
          return { disabled: true, reason: "No channels" }
        }
        return { disabled: false }
      },
      run: (ctx) => {
        ctx.setSelectedChannels(
          new Set(ctx.channels.map((channel) => channel.name)),
        )
      },
    },
    {
      id: "clear-channel-selection",
      kind: "action",
      label: "Clear Channel Selection",
      keywords: ["channels", "clear", "selection", "none"],
      group: "Channels",
      disabled: (ctx) =>
        ctx.selectedChannels.size === 0
          ? { disabled: true, reason: "No channels selected" }
          : { disabled: false },
      run: (ctx) => {
        ctx.setSelectedChannels(new Set())
      },
    },
    {
      id: "freeze-selected-channels",
      kind: "action",
      label: "Freeze Selected Channels",
      keywords: ["channels", "freeze", "bulk", "selected"],
      group: "Channels",
      requiresConfirmation: true,
      confirmDescription:
        "Freeze all currently selected channels. They will be skipped during sync.",
      disabled: (ctx) =>
        ctx.selectedChannels.size === 0
          ? { disabled: true, reason: "No channels selected" }
          : { disabled: false },
      run: async (ctx) => {
        await runBulkFreezeSelected(ctx)
      },
    },
    {
      id: "unfreeze-selected-channels",
      kind: "action",
      label: "Unfreeze Selected Channels",
      keywords: ["channels", "unfreeze", "bulk", "selected"],
      group: "Channels",
      requiresConfirmation: true,
      confirmDescription: "Unfreeze all currently selected channels.",
      disabled: (ctx) =>
        ctx.selectedChannels.size === 0
          ? { disabled: true, reason: "No channels selected" }
          : { disabled: false },
      run: async (ctx) => {
        await runBulkUnfreezeSelected(ctx)
      },
    },
  ]
}

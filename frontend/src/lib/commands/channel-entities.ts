import type { CommandDef } from "@/lib/commands/types"
import {
  runBulkFreezeSelected,
  runBulkUnfreezeSelected,
} from "@/lib/commands/useChannelEntityFlow"

export function buildChannelEntityCommands(): CommandDef[] {
  return [
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
      id: "open-post",
      kind: "entity-root",
      label: "Open Post by ID",
      keywords: ["post", "open", "id"],
      group: "Channels",
      entityFlow: "open-post",
      when: () => false,
      run: () => {},
    },
    {
      id: "select-all-channels",
      kind: "action",
      label: "Select All Channels",
      keywords: ["channels", "select", "all"],
      group: "Channels",
      disabled: (ctx) => {
        const selectable = ctx.channels.filter((channel) => !channel.isFrozen)
        if (selectable.length === 0) {
          return { disabled: true, reason: "No selectable channels" }
        }
        return { disabled: false }
      },
      run: (ctx) => {
        ctx.setSelectedChannels(
          new Set(
            ctx.channels
              .filter((channel) => !channel.isFrozen)
              .map((channel) => channel.name),
          ),
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

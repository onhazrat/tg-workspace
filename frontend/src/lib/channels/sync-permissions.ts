import type { Channel } from "@/types"

export type SyncOperation =
  | "sync_all"
  | "bulk"
  | "individual"
  | "reset"
  | "bulk_reset"

const PERMISSION_FIELD: Record<
  SyncOperation,
  keyof Pick<
    Channel,
    | "includeInSyncAll"
    | "includeInBulkSync"
    | "allowIndividualSync"
    | "resetSyncEnabled"
  >
> = {
  sync_all: "includeInSyncAll",
  bulk: "includeInBulkSync",
  individual: "allowIndividualSync",
  reset: "resetSyncEnabled",
  bulk_reset: "resetSyncEnabled",
}

const PERMISSION_LABEL: Record<SyncOperation, string> = {
  sync_all: "Include in Sync All",
  bulk: "Include in bulk sync",
  individual: "Allow individual sync",
  reset: "Reset & Sync",
  bulk_reset: "Reset & Sync",
}

function effectiveFlag(channel: Channel, field: keyof Channel): boolean {
  const value = channel[field]
  return value !== false
}

export function channelAllows(channel: Channel, op: SyncOperation): boolean {
  if (op === "bulk_reset") {
    return (
      effectiveFlag(channel, "includeInBulkSync") &&
      effectiveFlag(channel, "resetSyncEnabled")
    )
  }
  return effectiveFlag(channel, PERMISSION_FIELD[op])
}

export function disabledReason(
  channel: Channel,
  op: SyncOperation,
): string | null {
  if (channelAllows(channel, op)) return null
  const groupName = channel.settingGroupName ?? "this group"
  const label = PERMISSION_LABEL[op]
  if (op === "bulk_reset") {
    if (!effectiveFlag(channel, "resetSyncEnabled")) {
      return `Reset disabled — group '${groupName}' has Reset & Sync off`
    }
    return `Bulk reset disabled — group '${groupName}' has bulk sync off`
  }
  return `Sync disabled — group '${groupName}' has ${label} off`
}

export function filterChannelsForOperation(
  channels: Channel[],
  op: SyncOperation,
): Channel[] {
  return channels.filter((channel) => channelAllows(channel, op))
}

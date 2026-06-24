import type { CommandDef } from "@/lib/commands/types"
import { buildDataCommands } from "@/lib/data-transfer/registry"

export function buildDataTransferCommands(): CommandDef[] {
  return buildDataCommands()
}

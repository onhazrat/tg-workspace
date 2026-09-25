import { normalizeChannelHandle } from "@/lib/commands/channel-ops"
import { getChainedEditorApply } from "@/lib/commands/extended-commands"
import { buildSearchResultsState } from "@/lib/commands/palette-search"
import type {
  CommandContext,
  CommandDef,
  EditorFieldDef,
  SearchResultsState,
} from "@/lib/commands/types"

/** Editors reached from a channel pick; they apply to the picked channel. */
const CHAINED_EDITOR_IDS = new Set(["add-tag-channel", "edit-channel-start-id"])

export interface EditorApplyDeps {
  command: CommandDef
  context: CommandContext
  value: string
  setApplying: (applying: boolean) => void
  openSearchResults: (state: SearchResultsState, command: CommandDef) => void
  /** Clears the search-results filter before showing fresh results. */
  onSearchResultsOpened: () => void
  recordRecent: (commandId: string) => void
  close: () => void
  /** The editor stays open after Apply (`closeOnApply: false`). */
  onStayOpen: () => void
  applyChained?: typeof getChainedEditorApply
  buildResults?: typeof buildSearchResultsState
}

type ApplyStep = (deps: EditorApplyDeps) => Promise<void>

async function applyChainedEditor({
  command,
  context,
  value,
  recordRecent,
  close,
  applyChained = getChainedEditorApply,
}: EditorApplyDeps): Promise<void> {
  await applyChained(command.id, context, value)
  recordRecent(command.id)
  close()
}

async function applyFieldEditor(
  field: EditorFieldDef,
  deps: EditorApplyDeps,
): Promise<void> {
  const {
    command,
    context,
    value,
    buildResults = buildSearchResultsState,
  } = deps
  await field.apply(context, value)

  const results = await buildResults(command, context, value)
  if (results) {
    deps.openSearchResults(results, command)
    deps.onSearchResultsOpened()
    deps.recordRecent(command.id)
    return
  }

  deps.recordRecent(command.id)
  if (command.closeOnApply !== false) {
    deps.close()
    return
  }
  deps.onStayOpen()
}

/** Which Apply runs for this command and value, or null when Apply is a no-op. */
export function editorApplyStep(
  command: CommandDef,
  value: string,
): ApplyStep | null {
  if (CHAINED_EDITOR_IDS.has(command.id)) return applyChainedEditor
  const field = command.editorField
  if (!field) return null
  const emptyAddChannel =
    command.id === "add-channel" &&
    !normalizeChannelHandle(value) &&
    !command.allowEmptyApply
  if (emptyAddChannel) return null
  return (deps) => applyFieldEditor(field, deps)
}

/** The editor's Apply: runs the step with the applying flag held around it. */
export async function applyEditor(deps: EditorApplyDeps): Promise<void> {
  const step = editorApplyStep(deps.command, deps.value)
  if (!step) return
  deps.setApplying(true)
  try {
    await step(deps)
  } finally {
    deps.setApplying(false)
  }
}

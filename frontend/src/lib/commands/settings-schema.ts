/**
 * The command palette's Settings commands, built from the registry (SET-02).
 *
 * Every Setting the Account can change gets a command that changes it: a
 * toggle for on / off, one per choice for a few choices, an editor for the
 * rest. Every topic gets "Go to Settings → topic", and every Setting a jump
 * by title or id. A write goes through the same door as the page.
 */
import { toast } from "sonner"
import type { SettingRow } from "@/client"
import type { CommandDef, EditorFieldDef } from "@/lib/commands/types"

export interface SettingsCommandSource {
  rows: SettingRow[]
  topics: { id: string; title: string }[]
  save: (row: SettingRow, value: unknown) => Promise<void>
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-")

function saver(source: SettingsCommandSource, row: SettingRow) {
  return (value: unknown) =>
    source.save(row, value).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : String(err))
    })
}

function editorField(
  row: SettingRow,
  save: (value: unknown) => Promise<void>,
): EditorFieldDef {
  const numeric = row.type === "integer" || row.type === "number"
  return {
    id: row.id,
    label: row.title,
    type: numeric ? "number" : "text",
    min: row.min ?? undefined,
    max: row.max ?? undefined,
    step: row.type === "number" ? "any" : undefined,
    integer: row.type === "integer",
    getValue: () =>
      typeof row.value === "number" ? row.value : String(row.value ?? ""),
    apply: async (_ctx, raw) => {
      if (!numeric) return save(raw)
      const value = Number(raw)
      if (raw.trim() === "" || Number.isNaN(value)) return
      return save(value)
    },
  }
}

function changeCommands(
  source: SettingsCommandSource,
  row: SettingRow,
): CommandDef[] {
  const save = saver(source, row)
  const keywords = [row.id, row.title, "setting"]
  if (row.type === "boolean") {
    return [
      {
        id: `toggle-${row.id}`,
        kind: "boolean",
        label: `Toggle ${row.title}`,
        keywords: [...keywords, "toggle", "enable", "disable"],
        group: "Settings",
        getBadge: () => (row.value ? "ON" : "OFF"),
        run: () => save(!row.value),
      },
    ]
  }
  if (row.type === "enum") {
    return (row.options ?? []).map((option) => ({
      id: `set-${row.id}-${slug(option.value)}`,
      kind: "enum" as const,
      label: `Set ${row.title} → ${option.label}`,
      keywords: [...keywords, option.value, option.label],
      group: "Settings",
      run: () => save(option.value),
    }))
  }
  if (row.type === "json") return []
  return [
    {
      id: `edit-${row.id}`,
      kind: "editor",
      label: `Set ${row.title}`,
      keywords: [...keywords, "edit"],
      group: "Settings",
      getBadge: () => (row.value == null ? null : String(row.value)),
      editorField: editorField(row, save),
      run: () => {},
    },
  ]
}

export function buildSettingCommands(
  source: SettingsCommandSource,
): CommandDef[] {
  const commands: CommandDef[] = source.topics.map((topic) => ({
    id: `navigate-settings-${topic.id}`,
    kind: "action",
    label: `Go to Settings → ${topic.title}`,
    keywords: [topic.id, topic.title, "settings", "navigate", "go"],
    group: "Navigate",
    run: (ctx) => ctx.openSetting(topic.id),
  }))
  for (const row of source.rows) {
    commands.push({
      id: `open-setting-${row.id}`,
      kind: "action",
      label: `Settings: ${row.title}`,
      keywords: [row.id, row.title, row.topic, "settings", "open"],
      group: "Settings",
      run: (ctx) => ctx.openSetting(row.id),
    })
    if (row.canEdit) commands.push(...changeCommands(source, row))
  }
  return commands
}

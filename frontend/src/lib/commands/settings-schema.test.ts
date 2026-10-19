import { describe, expect, mock, test } from "bun:test"
import type { SettingRow } from "@/client"
import type { CommandContext } from "@/lib/commands/types"
import { buildSettingCommands } from "./settings-schema"

function row(overrides: Partial<SettingRow>): SettingRow {
  return {
    id: "retention.yours.logDays",
    title: "Keep your logs for",
    description: "",
    topic: "retention",
    scope: "account",
    type: "integer",
    value: 7,
    default: 7,
    defaultSource: "env",
    modified: false,
    canEdit: true,
    lockReason: null,
    storage: "tg_user_settings.retention_prefs.logRetentionDays",
    ...overrides,
  }
}

const topics = [{ id: "retention", title: "Retention" }]

describe("buildSettingCommands", () => {
  test("a topic gets a go-to and every Setting a jump by title or id", () => {
    const openSetting = mock()
    const ctx = { openSetting } as unknown as CommandContext
    const commands = buildSettingCommands({
      rows: [row({ canEdit: false })],
      topics,
      save: async () => {},
    })
    const goTo = commands.find((c) => c.label === "Go to Settings → Retention")
    const jump = commands.find(
      (c) => c.id === "open-setting-retention.yours.logDays",
    )
    void goTo?.run(ctx)
    void jump?.run(ctx)
    expect(openSetting.mock.calls).toEqual([
      ["retention"],
      ["retention.yours.logDays"],
    ])
    expect(jump?.keywords).toContain("retention.yours.logDays")
    // A Setting the Account cannot change gets no command that changes it.
    expect(commands.map((c) => c.kind)).toEqual(["action", "action"])
  })

  test("each kind of Setting gets the command that changes it", async () => {
    const save = mock(async () => {})
    const commands = buildSettingCommands({
      rows: [
        row({ id: "a.yours.on", type: "boolean", value: false }),
        row({
          id: "a.yours.style",
          type: "enum",
          options: [
            { value: "asWritten", label: "As written" },
            { value: "numbered", label: "Numbered" },
          ],
        }),
        row({ id: "a.yours.days", type: "integer", value: 7, min: 0 }),
        row({ id: "a.yours.raw", type: "json" }),
      ],
      topics,
      save,
    })
    const ctx = {} as CommandContext
    await commands.find((c) => c.id === "toggle-a.yours.on")?.run(ctx)
    await commands.find((c) => c.id === "set-a.yours.style-numbered")?.run(ctx)
    const editor = commands.find((c) => c.id === "edit-a.yours.days")
    await editor?.editorField?.apply(ctx, "12")
    await editor?.editorField?.apply(ctx, "")
    expect(save.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      true,
      "numbered",
      12,
    ])
    expect(editor?.editorField?.min).toBe(0)
    expect(
      commands.some((c) => c.id.endsWith("a.yours.raw") && c.kind !== "action"),
    ).toBe(false)
  })
})

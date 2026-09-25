import { describe, expect, test } from "bun:test"
import {
  buildChannelTelegramChatIdCommands,
  emptyTelegramChatIdMessage,
  telegramChatIdCopy,
} from "@/lib/commands/channel-telegram-chat-id-commands"
import type { CommandContext } from "@/lib/commands/types"
import type { Channel } from "@/types"

const beta: Channel = { id: "b", name: "beta", telegramChatId: -1002 }
const alpha: Channel = { id: "a", name: "alpha", telegramChatId: -1001 }

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    channels: [],
    selectedChannels: new Set<string>(),
    ...overrides,
  } as CommandContext
}

describe("buildChannelTelegramChatIdCommands", () => {
  const commands = buildChannelTelegramChatIdCommands()
  const byId = (id: string) => {
    const command = commands.find((entry) => entry.id === id)
    if (!command) throw new Error(`missing ${id}`)
    return command
  }

  test("builds ids and name-tsv copies for each filter, then the single pick", () => {
    expect(commands.map((command) => command.id)).toEqual([
      "copy-channel-telegram-chat-ids-all",
      "copy-channel-telegram-chat-ids-selected",
      "copy-channel-telegram-chat-ids-frozen",
      "copy-channel-names-and-telegram-chat-ids-all",
      "copy-channel-names-and-telegram-chat-ids-selected",
      "copy-channel-names-and-telegram-chat-ids-frozen",
      "copy-channel-telegram-chat-id",
    ])
  })

  test("labels and keywords name the filter and the format", () => {
    const ids = byId("copy-channel-telegram-chat-ids-frozen")
    expect(ids.label).toBe("Copy List of Frozen Telegram Chat IDs")
    expect(ids.keywords).toContain("freeze")
    expect(ids.keywords).toContain("numeric")
    expect(ids.keywords).not.toContain("tsv")

    const tsv = byId("copy-channel-names-and-telegram-chat-ids-selected")
    expect(tsv.label).toBe(
      "Copy List of Selected Channel Names and Telegram Chat IDs",
    )
    expect(tsv.keywords).toContain("selection")
    expect(tsv.keywords).toContain("tsv")
    expect(tsv.keywords).not.toContain("numeric")

    expect(byId("copy-channel-telegram-chat-ids-all").keywords).toContain("all")
  })

  test("the selected copy is disabled with nothing selected", () => {
    const command = byId("copy-channel-telegram-chat-ids-selected")
    expect(command.disabled?.(ctx())).toEqual({
      disabled: true,
      reason: "No channels selected",
    })
    expect(
      command.disabled?.(ctx({ selectedChannels: new Set(["alpha"]) })),
    ).toEqual({ disabled: false })
  })

  test("the frozen copy is disabled with no frozen channel", () => {
    const command = byId("copy-channel-names-and-telegram-chat-ids-frozen")
    expect(command.disabled?.(ctx({ channels: [alpha] }))).toEqual({
      disabled: true,
      reason: "No frozen channels",
    })
    expect(
      command.disabled?.(ctx({ channels: [{ ...alpha, isFrozen: true }] })),
    ).toEqual({ disabled: false })
  })

  test("the all copy is never disabled", () => {
    expect(
      byId("copy-channel-telegram-chat-ids-all").disabled?.(ctx()),
    ).toEqual({ disabled: false })
  })

  test("the single pick needs a channel that has a chat id", () => {
    const command = byId("copy-channel-telegram-chat-id")
    expect(
      command.disabled?.(ctx({ channels: [{ id: "c", name: "c" }] })),
    ).toEqual({
      disabled: true,
      reason: "No channels with Telegram chat IDs — sync channels first",
    })
    expect(command.disabled?.(ctx({ channels: [alpha] }))).toEqual({
      disabled: false,
    })
  })
})

describe("emptyTelegramChatIdMessage", () => {
  test("names the filter scope, or none for all", () => {
    expect(emptyTelegramChatIdMessage("all")).toBe(
      "No Telegram chat IDs to copy — sync channels to populate IDs",
    )
    expect(emptyTelegramChatIdMessage("selected")).toBe(
      "No Telegram chat IDs to copy for selected channels — sync channels to populate IDs",
    )
    expect(emptyTelegramChatIdMessage("frozen")).toBe(
      "No Telegram chat IDs to copy for frozen channels — sync channels to populate IDs",
    )
  })
})

describe("telegramChatIdCopy", () => {
  test("ids are sorted lines with a plural count", () => {
    expect(telegramChatIdCopy([alpha, beta], false, false)).toEqual({
      text: "-1001\n-1002",
      message: "Copied 2 Telegram chat IDs",
    })
  })

  test("name-tsv sorts by the line and counts one name without an s", () => {
    expect(telegramChatIdCopy([beta], true, false)).toEqual({
      text: "beta\t-1002",
      message: "Copied 1 channel name with Telegram chat IDs",
    })
    expect(telegramChatIdCopy([beta, alpha], true, false).text).toBe(
      "alpha\t-1001\nbeta\t-1002",
    )
  })

  test("offline copies say they came from the local cache", () => {
    const hint = " (from local cache — may not include latest server data)"
    expect(telegramChatIdCopy([alpha], false, true).message).toBe(
      `Copied 1 Telegram chat ID${hint}`,
    )
    expect(telegramChatIdCopy([alpha, beta], true, true).message).toBe(
      `Copied 2 channel names with Telegram chat IDs${hint}`,
    )
  })
})

/**
 * The decisions `BotManagement` makes and the destination list it renders.
 * The handlers stay in `BotManagement` with the hooks and the store; what is
 * pinned here is what they decide: when a lookup runs, which name it fills in,
 * what a Bot API answer means for a bot or a destination, and which rows the
 * network and publish logs get. The network log must never carry the token.
 */
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ChatDestination } from "@/types"
import { DestinationRow, DestinationsPanel } from "./DestinationsPanel"
import {
  autofillName,
  type BotApiCall,
  botDisplayName,
  botNetworkLog,
  botPhotoPath,
  canLookUpChat,
  chatDisplayName,
  checkBotToken,
  destinationStatus,
  destinationValidation,
  errorText,
  looksLikeBotToken,
  publishLogFor,
  visiblePanels,
} from "./publishing-model"

afterEach(cleanup)

const TOKEN = "123456789:AAEexampleexampleexample"

describe("when a lookup runs", () => {
  test("a bot token is looked up once it has a colon and 21 characters", () => {
    expect(looksLikeBotToken(TOKEN)).toBe(true)
    expect(looksLikeBotToken("123456789AAEexampleexampl")).toBe(false)
    expect(looksLikeBotToken("1:".padEnd(20, "x"))).toBe(false)
    expect(looksLikeBotToken("1:".padEnd(21, "x"))).toBe(true)
  })

  test("a chat id is looked up from four characters, and only with a bot", () => {
    expect(canLookUpChat("@ab", 1)).toBe(false)
    expect(canLookUpChat("@abc", 0)).toBe(false)
    expect(canLookUpChat("@abc", 1)).toBe(true)
    expect(canLookUpChat("-100", 2)).toBe(true)
  })
})

describe("autofillName", () => {
  test("fills a blank field from a successful lookup, and nothing else", () => {
    const ok = { ok: true, result: { first_name: "Helper", username: "hb" } }
    expect(autofillName(ok, "", botDisplayName)).toBe("Helper")
    expect(autofillName(ok, "Typed", botDisplayName)).toBeNull()
    expect(autofillName({ ok: false }, "", botDisplayName)).toBeNull()
    // A result with no name at all still clears to "", as before.
    expect(autofillName({ ok: true, result: {} }, "", botDisplayName)).toBe("")
  })

  test("a bot is named by first name then username; a chat by title first", () => {
    expect(botDisplayName({ username: "hb" })).toBe("hb")
    expect(botDisplayName({ title: "T" })).toBe("")
    expect(chatDisplayName({ title: "T", username: "u" })).toBe("T")
    expect(chatDisplayName({ username: "u", first_name: "F" })).toBe("u")
    expect(chatDisplayName({ first_name: "F" })).toBe("F")
    expect(chatDisplayName({})).toBe("")
  })
})

describe("destinationValidation", () => {
  test("a found chat is valid, named, and typed", () => {
    expect(
      destinationValidation({
        ok: true,
        result: { title: "News", type: "channel" },
      }),
    ).toEqual({ isValid: true, info: "News (CHANNEL)", loading: false })
    expect(destinationValidation({ ok: true, result: {} })).toEqual({
      isValid: true,
      info: "Valid Chat",
      loading: false,
    })
  })

  test("a refusal carries Telegram's description, or a fallback", () => {
    expect(
      destinationValidation({ ok: false, description: "chat not found" }),
    ).toEqual({ isValid: false, info: "chat not found", loading: false })
    expect(destinationValidation({ ok: false }).info).toBe("Invalid Chat ID")
  })
})

describe("destinationStatus", () => {
  test("checking, valid and invalid each read differently", () => {
    expect(destinationStatus({ isValid: false, loading: true })).toEqual({
      label: "Checking...",
      toneClass: "text-red-500",
      details: "Verifying...",
    })
    expect(
      destinationStatus({ isValid: true, info: "News", loading: false }),
    ).toEqual({ label: "Valid", toneClass: "text-green-500", details: "News" })
    expect(destinationStatus({ isValid: false, loading: false })).toEqual({
      label: "Invalid",
      toneClass: "text-red-500",
      details: "Invalid",
    })
  })
})

describe("checkBotToken", () => {
  const me = {
    id: 7,
    username: "hb",
    first_name: "Helper",
    can_join_groups: true,
    can_read_all_group_messages: false,
  }
  const answers: Record<string, unknown> = {
    getMe: { ok: true, result: me },
    getUserProfilePhotos: {
      ok: true,
      result: { total_count: 1, photos: [[{ file_id: "f1" }]] },
    },
    getFile: { ok: true, result: { file_path: "photos/f1.jpg" } },
  }
  const api = (over: Record<string, unknown> = {}) =>
    mock(
      (async (_id, _token, method) =>
        ({ ...answers, ...over })[method]) as BotApiCall,
    )

  test("a good token validates and brings its username and photo", async () => {
    const call = api()
    expect(await checkBotToken(call, "b1")).toEqual({
      validation: { isValid: true, botInfo: "@hb (Helper)", loading: false },
      profile: { username: "hb", photoPath: "photos/f1.jpg" },
    })
    // Saved bots are asked by credential id, never by token.
    for (const [id, token] of call.mock.calls) {
      expect(id).toBe("b1")
      expect(token).toBeUndefined()
    }
  })

  test("a refused token is invalid and records no profile", async () => {
    expect(await checkBotToken(api({ getMe: { ok: false } }), "b1")).toEqual({
      validation: { isValid: false, botInfo: "Invalid Token", loading: false },
    })
  })

  test("a network failure on getMe throws for the caller to report", async () => {
    const call = mock(async () => {
      throw new Error("offline")
    })
    await expect(checkBotToken(call, "b1")).rejects.toThrow("offline")
  })

  test("the photo is only fetched for bots that can join groups", async () => {
    const call = api()
    expect(
      await botPhotoPath(call, "b1", { ...me, can_join_groups: false }),
    ).toBe("")
    expect(
      await botPhotoPath(call, "b1", {
        ...me,
        can_read_all_group_messages: undefined,
      }),
    ).toBe("")
    expect(call).not.toHaveBeenCalled()
  })

  test("no photo, a failed getFile, or an error all leave the path empty", async () => {
    const none = { ok: true, result: { total_count: 0, photos: [] } }
    expect(
      await botPhotoPath(api({ getUserProfilePhotos: none }), "b1", me),
    ).toBe("")
    expect(await botPhotoPath(api({ getFile: { ok: false } }), "b1", me)).toBe(
      "",
    )
    const logged = spyOn(console, "error").mockImplementation(() => {})
    const failing = mock(async () => {
      throw new Error("offline")
    })
    expect(await botPhotoPath(failing, "b1", me)).toBe("")
    logged.mockRestore()
  })
})

describe("botNetworkLog", () => {
  test("names the method, never the token, and reads the last attempt", () => {
    const log = botNetworkLog({
      method: "getMe",
      statusCode: 200,
      telemetry: {
        totalDuration: 900,
        attempts: [{ proxyUrl: "a" }, { proxyUrl: "b" }],
      },
      duration: 50,
    })
    expect(log).toMatchObject({
      url: "https://api.telegram.org/bot.../getMe",
      status: "success",
      statusCode: 200,
      duration: 900,
      proxyUsed: "b",
      attempts: 2,
      source: "BotManagement",
    })
    expect(JSON.stringify(log)).not.toContain(TOKEN)
  })

  test("a failure with no telemetry is one attempt at the measured duration", () => {
    expect(
      botNetworkLog({
        method: "getChat",
        statusCode: 0,
        error: "offline",
        duration: 50,
      }),
    ).toMatchObject({
      status: "failed",
      statusCode: 0,
      error: "offline",
      duration: 50,
      attempts: 1,
      proxyUsed: undefined,
    })
  })
})

describe("publishLogFor", () => {
  test("records the send against the bot and destination it used", () => {
    const log = publishLogFor({
      kind: "test",
      botId: "b1",
      botName: "Helper",
      chatId: "@news",
      destName: "News",
      text: "hi",
      result: { success: false, error: "nope", requests: [1], responses: [2] },
    })
    expect(log).toMatchObject({
      botId: "b1",
      botName: "Helper",
      chatId: "@news",
      chatName: "News",
      status: "failed",
      error: "nope",
      textSent: "hi",
      fullRequest: [1],
      fullResponse: [2],
    })
    expect(log.summaryId).toMatch(/^test-\d+$/)
    const quick = publishLogFor({
      kind: "quick",
      botId: "b1",
      botName: "Helper",
      chatId: "@news",
      destName: "News",
      text: "hi",
      result: { success: true },
    })
    expect(quick.status).toBe("success")
    expect(quick.summaryId).toMatch(/^quick-\d+$/)
  })

  test("errorText reads an Error's message and stringifies the rest", () => {
    expect(errorText(new Error("boom"))).toBe("boom")
    expect(errorText("plain")).toBe("plain")
  })
})

describe("visiblePanels", () => {
  test("publishing shows all three; quick message needs a bot and a destination", () => {
    expect(visiblePanels("publishing", 1, 1)).toEqual({
      credentials: true,
      destinations: true,
      quickMessage: true,
    })
    expect(visiblePanels("publishing", 0, 1).quickMessage).toBe(false)
    expect(visiblePanels("publishing", 1, 0).quickMessage).toBe(false)
  })

  test("a focused section shows only its own panel", () => {
    expect(visiblePanels("bot-credentials", 1, 1)).toEqual({
      credentials: true,
      destinations: false,
      quickMessage: false,
    })
    expect(visiblePanels("destinations", 1, 1)).toEqual({
      credentials: false,
      destinations: true,
      quickMessage: false,
    })
    expect(visiblePanels("quick-message", 1, 1)).toEqual({
      credentials: false,
      destinations: false,
      quickMessage: true,
    })
  })
})

const dest: ChatDestination = { id: "d1", name: "News", chatId: "@news" }

describe("DestinationRow", () => {
  test("an unchecked destination shows no status and no badge", () => {
    render(
      <DestinationRow dest={dest} onCheck={() => {}} onDelete={() => {}} />,
    )
    expect(screen.getByText("News")).toBeTruthy()
    expect(screen.getByText("@news")).toBeTruthy()
    expect(screen.queryByTestId("destination-status")).toBeNull()
    expect(screen.queryByTestId("destination-valid-badge")).toBeNull()
    expect(screen.queryByLabelText("Test Connection")).toBeNull()
  })

  test("a valid destination shows the badge and its details", () => {
    render(
      <DestinationRow
        dest={dest}
        validation={{ isValid: true, info: "News (CHANNEL)", loading: false }}
        onCheck={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.getByTestId("destination-valid-badge")).toBeTruthy()
    const status = screen.getByTestId("destination-status")
    expect(status.textContent).toBe("Valid")
    expect(status.className).toContain("text-green-500")
    expect(screen.getByTestId("destination-details").textContent).toBe(
      "News (CHANNEL)",
    )
  })

  test("each action calls back", () => {
    const onCheck = mock(() => {})
    const onTest = mock(() => {})
    const onDelete = mock(() => {})
    render(
      <DestinationRow
        dest={dest}
        onCheck={onCheck}
        onTest={onTest}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByLabelText("Verify Destination"))
    fireEvent.click(screen.getByLabelText("Test Connection"))
    fireEvent.click(screen.getByLabelText("Delete Destination"))
    expect(onCheck).toHaveBeenCalledTimes(1)
    expect(onTest).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

describe("DestinationsPanel", () => {
  const props = {
    chatDestinations: [dest],
    botCredentials: [],
    newDestChatId: "",
    newDestName: "",
    isAutoFetchingDest: false,
    isSavingDest: false,
    destValidation: {},
    onDestChatIdChange: () => {},
    onDestNameChange: () => {},
    onAddDestination: () => {},
    onCheckDestination: () => {},
    onTestConnection: () => {},
    onDeleteDestination: () => {},
  }

  test("says so when there is nothing saved", () => {
    render(<DestinationsPanel {...props} chatDestinations={[]} />)
    expect(screen.getByText("No destinations saved yet.")).toBeTruthy()
  })

  test("Test Connection needs a bot, and tests with the first one", () => {
    const { rerender } = render(<DestinationsPanel {...props} />)
    expect(screen.queryByLabelText("Test Connection")).toBeNull()

    const onTestConnection = mock(() => {})
    const onCheckDestination = mock(() => {})
    const onDeleteDestination = mock(() => {})
    rerender(
      <DestinationsPanel
        {...props}
        botCredentials={[
          { id: "b1", name: "First" },
          { id: "b2", name: "Second" },
        ]}
        onTestConnection={onTestConnection}
        onCheckDestination={onCheckDestination}
        onDeleteDestination={onDeleteDestination}
      />,
    )
    fireEvent.click(screen.getByLabelText("Test Connection"))
    expect(onTestConnection).toHaveBeenCalledWith(
      "b1",
      "@news",
      "First",
      "News",
    )
    fireEvent.click(screen.getByLabelText("Verify Destination"))
    expect(onCheckDestination).toHaveBeenCalledWith("d1", "@news")
    fireEvent.click(screen.getByLabelText("Delete Destination"))
    expect(onDeleteDestination).toHaveBeenCalledWith("d1")
  })
})

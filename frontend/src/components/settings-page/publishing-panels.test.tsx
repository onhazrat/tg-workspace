/**
 * The bots and destinations tables (SET-03), props only. What the old panel
 * did and these must keep: the name looked up while a token or chat id is
 * typed (and never over a name the Account typed), Check, and the test
 * message, which needs a bot to send with.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { BotCredential, ChatDestination, PublishLog } from "@/types"
import { BotsView, DestinationsView, sentByBot } from "./publishing-panels"

afterEach(cleanup)

const TOKEN = "123456789:AAEexampleexampleexample"
const bot: BotCredential = { id: "b1", name: "Herald", username: "herald_bot" }
const dest: ChatDestination = { id: "d1", name: "News", chatId: "@news" }

const botProps = {
  bots: [bot],
  sent: { b1: 3 },
  validation: {},
  onLookUp: async () => null,
  onAdd: async () => {},
  onCheck: () => {},
  onDelete: async () => {},
}

describe("BotsView", () => {
  test("a typed token fills in the bot's name, and adding sends both", async () => {
    const onLookUp = mock(async () => "Herald Two")
    const onAdd = mock(async (_t: string, _n: string) => {})
    render(<BotsView {...botProps} onLookUp={onLookUp} onAdd={onAdd} />)
    fireEvent.click(screen.getByRole("button", { name: "Add bot" }))
    fireEvent.change(screen.getByLabelText("Bot token"), {
      target: { value: TOKEN },
    })
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Bot name") as HTMLInputElement).value,
      ).toBe("Herald Two"),
    )
    expect(onLookUp).toHaveBeenCalledWith(TOKEN, "")
    fireEvent.click(screen.getByRole("button", { name: "Save bot" }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(TOKEN, "Herald Two"))
  })

  test("a lookup that answers nothing leaves the name alone", async () => {
    render(<BotsView {...botProps} />)
    fireEvent.click(screen.getByRole("button", { name: "Add bot" }))
    fireEvent.change(screen.getByLabelText("Bot name"), {
      target: { value: "Mine" },
    })
    fireEvent.change(screen.getByLabelText("Bot token"), {
      target: { value: TOKEN },
    })
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Bot name") as HTMLInputElement).value,
      ).toBe("Mine"),
    )
  })

  test("each bot shows its username, what it sent, and its check", () => {
    const onCheck = mock((_id: string) => {})
    const { rerender } = render(<BotsView {...botProps} onCheck={onCheck} />)
    const row = screen.getByRole("row", { name: /Herald/ })
    expect(row.textContent).toContain("@herald_bot")
    expect(row.textContent).toContain("3")
    expect(row.textContent).toContain("Not checked")
    fireEvent.click(screen.getByRole("button", { name: "Check Herald" }))
    expect(onCheck).toHaveBeenCalledWith("b1")
    rerender(
      <BotsView
        {...botProps}
        validation={{
          b1: { isValid: false, botInfo: "Invalid Token", loading: false },
        }}
      />,
    )
    expect(screen.getByRole("row", { name: /Herald/ }).textContent).toContain(
      "Invalid Token",
    )
  })
})

describe("sentByBot", () => {
  test("counts each bot's successful sends and nothing else", () => {
    const log = (botId: string, status: string) =>
      ({ botId, status }) as unknown as PublishLog
    expect(
      sentByBot([
        log("b1", "success"),
        log("b1", "failed"),
        log("b2", "success"),
        log("b1", "success"),
      ]),
    ).toEqual({ b1: 2, b2: 1 })
  })
})

const destProps = {
  destinations: [dest],
  hasBot: true,
  validation: {},
  onLookUp: async () => null,
  onAdd: async () => {},
  onCheck: () => {},
  onTest: () => {},
  onDelete: async () => {},
}

describe("DestinationsView", () => {
  test("a typed chat id fills in the chat's name", async () => {
    const onLookUp = mock(async () => "The News")
    const onAdd = mock(async (_c: string, _n: string) => {})
    render(
      <DestinationsView {...destProps} onLookUp={onLookUp} onAdd={onAdd} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Add destination" }))
    fireEvent.change(screen.getByLabelText("Chat id"), {
      target: { value: "@thenews" },
    })
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Destination name") as HTMLInputElement).value,
      ).toBe("The News"),
    )
    fireEvent.click(screen.getByRole("button", { name: "Save destination" }))
    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith("@thenews", "The News"),
    )
  })

  test("Check and the test message act on the row's destination", () => {
    const onCheck = mock((_d: ChatDestination) => {})
    const onTest = mock((_d: ChatDestination) => {})
    render(
      <DestinationsView {...destProps} onCheck={onCheck} onTest={onTest} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Check News" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Send a test message to News" }),
    )
    expect(onCheck).toHaveBeenCalledWith(dest)
    expect(onTest).toHaveBeenCalledWith(dest)
  })

  test("with no bot there is nothing to check or test with", () => {
    render(<DestinationsView {...destProps} hasBot={false} />)
    expect(
      (screen.getByRole("button", { name: "Check News" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      screen.queryByRole("button", { name: "Send a test message to News" }),
    ).toBeNull()
  })

  test("a checked destination reads what Telegram said", () => {
    render(
      <DestinationsView
        {...destProps}
        validation={{
          d1: { isValid: true, info: "News (CHANNEL)", loading: false },
        }}
      />,
    )
    expect(screen.getByRole("row", { name: /News/ }).textContent).toContain(
      "News (CHANNEL)",
    )
  })
})

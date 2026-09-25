import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { BotCredential, PublishLog } from "@/types"
import { BotCredentialsPanel } from "./BotCredentialsPanel"

afterEach(cleanup)

const bot = (
  id: string,
  extra: Partial<BotCredential> = {},
): BotCredential => ({
  id,
  name: `Bot ${id}`,
  ...extra,
})

const log = (botId: string, status: PublishLog["status"]): PublishLog => ({
  id: `${botId}-${status}-${Math.random()}`,
  summaryId: "s",
  botId,
  botName: "",
  chatId: "c",
  chatName: "",
  status,
  timestamp: 0,
})

const props = {
  publishLogs: [],
  newBotToken: "",
  newBotName: "",
  isAutoFetchingBot: false,
  isSavingBot: false,
  botValidation: {},
  onBotTokenChange: () => {},
  onBotNameChange: () => {},
  onAddBot: () => {},
  onCheckBot: () => {},
  onDeleteBot: () => {},
}

describe("BotCredentialsPanel", () => {
  test("an empty list says so", () => {
    render(<BotCredentialsPanel {...props} botCredentials={[]} />)
    expect(screen.getByText("No bot credentials saved yet.")).toBeTruthy()
  })

  test("each row shows its validation state and counts only its successes", () => {
    render(
      <BotCredentialsPanel
        {...props}
        botCredentials={[
          bot("a", { username: "abot", hasToken: true, lastValidated: 1 }),
          bot("b"),
          bot("c"),
          bot("d"),
        ]}
        publishLogs={[
          log("a", "success"),
          log("a", "success"),
          log("a", "failed"),
          log("b", "success"),
        ]}
        botValidation={{
          a: { isValid: true, loading: false },
          b: { isValid: false, loading: false },
          c: { isValid: false, loading: true },
        }}
      />,
    )
    expect(screen.getByText("@abot")).toBeTruthy()
    expect(screen.getByText("Token stored on server")).toBeTruthy()
    expect(screen.getAllByText("No token")).toHaveLength(3)
    expect(screen.getByText("Active")).toBeTruthy()
    expect(screen.getByText("Invalid")).toBeTruthy()
    expect(screen.getByText("Checking...")).toBeTruthy()
    expect(screen.getByText("Unknown")).toBeTruthy()
    expect(screen.getByText("2")).toBeTruthy()
    expect(screen.getAllByText("Last Validated")).toHaveLength(1)
  })

  test("the row buttons name their bot", () => {
    const onCheckBot = mock()
    const onDeleteBot = mock()
    render(
      <BotCredentialsPanel
        {...props}
        botCredentials={[bot("a")]}
        onCheckBot={onCheckBot}
        onDeleteBot={onDeleteBot}
      />,
    )
    fireEvent.click(screen.getByLabelText("Validate Token"))
    fireEvent.click(screen.getByLabelText("Delete Bot"))
    expect(onCheckBot).toHaveBeenCalledWith("a")
    expect(onDeleteBot).toHaveBeenCalledWith("a")
  })
})

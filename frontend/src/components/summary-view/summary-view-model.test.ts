/**
 * `SummaryView`'s two decisions. What is pinned: the list row wins over the
 * detail fetch but the detail alone still opens a Summary, the live stream wins
 * over the stored text, and a manual publish logs every answer Telegram gives,
 * refuses while offline and turns a throw into a toast.
 */
import { describe, expect, mock, test } from "bun:test"

import type {
  BotCredential,
  ChatDestination,
  PublishLog,
  Summary,
} from "@/types"
import {
  type PublishIo,
  publishFromView,
  summaryViewState,
} from "./summary-view-model"

const saved = (over: Partial<Summary>): Summary => ({
  id: "s1",
  text: "stored",
  language: "English",
  postCount: 1,
  timestamp: 0,
  ...over,
})

const state = (over: Partial<Parameters<typeof summaryViewState>[0]>) =>
  summaryViewState({
    history: [],
    currentSummaryId: "s1",
    detail: undefined,
    streamed: null,
    regenerating: new Set(),
    summarizing: false,
    ...over,
  })

describe("summaryViewState", () => {
  test("nothing open: no body, not pending, not running", () => {
    expect(state({ currentSummaryId: null })).toEqual({
      currentSummary: undefined,
      summaryBody: null,
      isPending: false,
      running: false,
    })
  })

  test("the list row wins, the detail supplies the text", () => {
    const row = { ...saved({ text: "row" }), chatMessageCount: 0 }
    const result = state({ history: [row], detail: saved({}) })
    expect(result.currentSummary).toBe(row)
    expect(result.summaryBody).toBe("stored")
  })

  test("the detail alone opens it, and the stream wins over its text", () => {
    const detail = saved({ status: "pending" })
    const result = state({ detail, streamed: "live" })
    expect(result.currentSummary).toBe(detail)
    expect(result.summaryBody).toBe("live")
    expect(result.isPending).toBe(true)
  })

  test("running while generating, or while this one regenerates", () => {
    expect(state({ summarizing: true }).running).toBe(true)
    expect(
      state({ detail: saved({}), regenerating: new Set(["s1"]) }).running,
    ).toBe(true)
    expect(
      state({ detail: saved({}), regenerating: new Set(["s2"]) }).running,
    ).toBe(false)
  })
})

const bot = { id: "b1", name: "Bot" } as BotCredential
const dest = { chatId: "c1", name: "Chat" } as ChatDestination
const settings = {
  proxyEnabled: true,
  defaultProxyUrls: "http://proxy:1",
  torEnabled: false,
  torMode: "auto" as const,
  torProxyUrls: "",
  torAutoRotate: true,
  torRotationThreshold: 7,
}

function fakeIo(publish: PublishIo["publish"]) {
  const logs: PublishLog[] = []
  const io = {
    publish: mock(publish),
    saveLog: mock(async (log: PublishLog) => {
      logs.push(log)
    }),
    notify: { success: mock(), error: mock(), warning: mock() },
    now: () => 1000,
  }
  return { io, logs }
}

const run = {
  bot,
  dest,
  text: "body",
  summaryId: "s1",
  metadata: "meta",
  isOffline: false,
  settings,
}

describe("publishFromView", () => {
  test("offline sends nothing and says why", async () => {
    const { io } = fakeIo(async () => ({ success: true }))
    await publishFromView({ ...run, isOffline: true }, io as never)
    expect(io.publish).not.toHaveBeenCalled()
    expect(io.notify.warning).toHaveBeenCalledWith(
      "Server offline — publish disabled.",
    )
  })

  test("a success is sent with the metadata and routing, logged and toasted", async () => {
    const { io, logs } = fakeIo(async () => ({ success: true }))
    await publishFromView(run, io as never)
    expect(io.publish).toHaveBeenCalledWith(
      "b1",
      "c1",
      "body",
      "meta",
      true,
      true,
      7,
    )
    expect(logs[0]).toMatchObject({
      summaryId: "s1",
      botName: "Bot",
      chatName: "Chat",
      status: "success",
      timestamp: 1000,
      textSent: "meta\n\nbody",
    })
    expect(io.notify.success).toHaveBeenCalledWith(
      "Successfully published using Bot!",
    )
  })

  test("a refusal is logged as failed, and an unsaved summary is manual", async () => {
    const { io, logs } = fakeIo(async () => ({ success: false, error: "nope" }))
    await publishFromView(
      { ...run, summaryId: null, metadata: null },
      io as never,
    )
    expect(io.publish.mock.calls[0][3]).toBeUndefined()
    expect(logs[0]).toMatchObject({
      summaryId: "manual-1000",
      status: "failed",
      error: "nope",
      textSent: "body",
    })
    expect(io.notify.error).toHaveBeenCalledWith("Error publishing: nope")
  })

  test("a throw is a toast and no log", async () => {
    const { io, logs } = fakeIo(async () => {
      throw new Error("down")
    })
    await publishFromView(run, io as never)
    expect(logs).toEqual([])
    expect(io.notify.error).toHaveBeenCalledWith("Error publishing: down")

    const { io: io2 } = fakeIo(() => Promise.reject("raw"))
    await publishFromView(run, io2 as never)
    expect(io2.notify.error).toHaveBeenCalledWith("Error publishing: raw")
  })
})

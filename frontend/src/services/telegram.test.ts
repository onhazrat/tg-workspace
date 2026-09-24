import { afterEach, describe, expect, it, type Mock, spyOn } from "bun:test"
import { api } from "@/api"
import type { NetworkLog } from "@/types"
import { publishSummary } from "./telegram"

/**
 * `publishSummary` decides whether a publish worked, and a 200 is not enough:
 * Telegram answers per chunk, so one refused chunk inside a successful HTTP
 * response is a failed publish. It also files one network log per telemetry
 * entry, without awaiting them, so the button never waits on logging.
 */

type PublishData = Awaited<ReturnType<typeof api.publish>>

let publish: Mock<typeof api.publish>
let createLogs: Mock<typeof api.createLogs>

function stub(result: PublishData | (() => Promise<PublishData>)) {
  publish = spyOn(api, "publish").mockImplementation(
    typeof result === "function" ? result : async () => result,
  )
  createLogs = spyOn(api, "createLogs").mockImplementation(
    async () => ({}) as Awaited<ReturnType<typeof api.createLogs>>,
  )
}

afterEach(() => {
  publish?.mockRestore()
  createLogs?.mockRestore()
})

const publishOnce = () =>
  publishSummary("cred-1", "@chan", "Summary text", "meta", true, false, 3)

/** The network logs written so far; they land after `publishSummary` returns. */
async function networkLogs(expected: number): Promise<NetworkLog[]> {
  for (let i = 0; i < 50 && createLogs.mock.calls.length < expected; i++)
    await new Promise((r) => setTimeout(r, 1))
  return createLogs.mock.calls.map(([type, logs]) => {
    expect(type).toBe("network")
    return (logs as NetworkLog[])[0]
  })
}

describe("publishSummary", () => {
  it("succeeds when every chunk is ok, echoing the request it sent", async () => {
    stub({ success: true, results: [{ ok: true }, { ok: true }] })
    const result = await publishOnce()
    const request = {
      credentialId: "cred-1",
      chatId: "@chan",
      text: "Summary text",
      metadataText: "meta",
      proxyEnabled: true,
      torAutoRotate: false,
      torRotationThreshold: 3,
    }
    expect(publish).toHaveBeenCalledWith(request)
    expect(result).toEqual({
      success: true,
      responses: [{ ok: true }, { ok: true }],
      requests: [request],
    })
  })

  it("fails on one refused chunk inside a 200, with Telegram's reason", async () => {
    stub({
      success: true,
      results: [{ ok: true }, { ok: false, description: "chat not found" }],
    })
    const result = await publishOnce()
    expect(result.success).toBe(false)
    expect(result.error).toBe("chat not found")
    expect(result.responses).toHaveLength(2)
  })

  it("fails with a generic reason when there are no results", async () => {
    stub({ success: true })
    const result = await publishOnce()
    expect(result).toMatchObject({
      success: false,
      error: "Publish failed: Telegram API returned an error",
      responses: [],
    })
  })

  it("fails when the server says so, even with ok chunks", async () => {
    stub({ success: false, results: [{ ok: true }] })
    expect(await publishOnce()).toMatchObject({
      success: false,
      error: "Publish failed: Telegram API returned an error",
    })
  })

  it("fails on a chunk that is not an object", async () => {
    stub({ results: [null] })
    const result = await publishOnce()
    expect(result.success).toBe(false)
    expect(result.error).toBe("Publish failed: Telegram API returned an error")
  })

  it("reports a thrown error's message and sends back no requests", async () => {
    stub(async () => {
      throw new Error("Bot credential not found")
    })
    expect(await publishOnce()).toEqual({
      success: false,
      error: "Bot credential not found",
      responses: [],
      requests: [],
    })
  })

  it("reports a thrown non-Error as a string", async () => {
    stub(async () => {
      throw "offline"
    })
    expect((await publishOnce()).error).toBe("offline")
  })

  it("writes no network log without telemetry", async () => {
    stub({ success: true, results: [{ ok: true }] })
    await publishOnce()
    expect(await networkLogs(0)).toEqual([])
  })

  it("writes one network log per telemetry entry, skipping empty ones", async () => {
    stub({
      success: true,
      results: [{ ok: true }],
      telemetry: [
        {
          success: true,
          totalDuration: 120,
          attempts: [{ proxyUrl: "socks5://a" }, { proxyUrl: "socks5://b" }],
        },
        null,
        { success: false },
      ] as unknown as PublishData["telemetry"],
    })
    await publishOnce()
    const logs = await networkLogs(2)
    expect(logs).toHaveLength(2)
    expect(logs[0]).toMatchObject({
      url: "https://api.telegram.org/bot.../sendMessage",
      method: "POST",
      status: "success",
      statusCode: 200,
      duration: 120,
      source: "Publisher",
      proxyUsed: "socks5://b",
      attempts: 2,
    })
    expect(logs[1]).toMatchObject({
      status: "failed",
      duration: 0,
      proxyUsed: undefined,
      attempts: 1,
    })
    expect(logs[0].id).not.toBe(logs[1].id)
  })

  it("accepts a single telemetry object as well as a list", async () => {
    stub({
      success: true,
      results: [{ ok: true }],
      telemetry: { success: true } as unknown as PublishData["telemetry"],
    })
    await publishOnce()
    expect(await networkLogs(1)).toHaveLength(1)
  })
})

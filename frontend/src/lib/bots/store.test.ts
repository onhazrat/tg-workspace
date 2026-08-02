import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { queryKeys } from "@/hooks/queryKeys"
import { queryClient } from "@/lib/queryClient"
import type { BotCredential, ChatDestination } from "@/types"
import {
  type BotsApi,
  deleteBotCredential,
  deleteChatDestination,
  listBotCredentials,
  listChatDestinations,
  saveBotCredential,
  saveChatDestination,
} from "./store"

/**
 * The bots + chat-destinations contract after A3.4.
 *
 * Two things are load-bearing here. **A token must never survive a read**, which
 * is the client half of the rule that `BotCredentialResponse` is closed and
 * carries only `hasToken`. And, as with channels and summaries, **a write must
 * not invalidate** — `BotManagement` writes the cache through itself.
 */

let calls: string[] = []
let serverReturnsToken = false

const bot = (id: string): BotCredential =>
  ({ id, name: `bot-${id}`, token: "secret-123" }) as BotCredential

const dest = (id: string): ChatDestination =>
  ({ id, chatId: "-100" }) as ChatDestination

const fakeApi = {
  listBotCredentials: async () => {
    calls.push("listBotCredentials")
    return serverReturnsToken
      ? [bot("b1")]
      : [{ id: "b1", name: "bot-b1", hasToken: true }]
  },
  upsertBotCredential: async (id: string, body: BotCredential) => {
    calls.push(`upsertBotCredential:${id}`)
    // A server that echoes the credential back verbatim, token included.
    return body
  },
  deleteBotCredential: async (id: string) => {
    calls.push(`deleteBotCredential:${id}`)
    return { status: "deleted" }
  },
  listChatDestinations: async () => {
    calls.push("listChatDestinations")
    return [dest("d1")]
  },
  upsertChatDestination: async (id: string, body: ChatDestination) => {
    calls.push(`upsertChatDestination:${id}`)
    return body
  },
  deleteChatDestination: async (id: string) => {
    calls.push(`deleteChatDestination:${id}`)
    return { status: "deleted" }
  },
} as unknown as BotsApi

function seedFresh() {
  queryClient.setQueryData(queryKeys.bots, [])
}

function isStale(): boolean {
  return (
    queryClient.getQueryCache().find({ queryKey: queryKeys.bots })?.isStale() ??
    true
  )
}

beforeEach(() => {
  calls = []
  serverReturnsToken = false
  queryClient.clear()
})

afterEach(() => {
  queryClient.clear()
})

describe("a bot token never survives a read", () => {
  it("strips a token the server should not have sent", async () => {
    serverReturnsToken = true

    const [row] = await listBotCredentials(fakeApi)

    // `BotCredentialResponse` is closed and carries only `hasToken`; this is
    // the client-side belt-and-braces for a server that regresses.
    expect("token" in row).toBe(false)
  })

  it("strips the token off a saved credential, though it was sent on the way in", async () => {
    const saved = await saveBotCredential(bot("b1"), fakeApi)

    expect(calls).toEqual(["upsertBotCredential:b1"])
    expect("token" in saved).toBe(false)
  })

  it("keeps the rest of the credential intact", async () => {
    const saved = await saveBotCredential(bot("b1"), fakeApi)

    expect(saved.id).toBe("b1")
    expect(saved.name).toBe("bot-b1")
  })
})

describe("writes do NOT invalidate", () => {
  it("saveBotCredential leaves the cached list fresh", async () => {
    seedFresh()
    expect(isStale()).toBe(false)

    await saveBotCredential(bot("b1"), fakeApi)

    expect(isStale()).toBe(false)
  })

  it("deleteBotCredential leaves the cached list fresh", async () => {
    seedFresh()

    await deleteBotCredential("b1", fakeApi)

    expect(calls).toEqual(["deleteBotCredential:b1"])
    expect(isStale()).toBe(false)
  })

  it("a write does not refetch either", async () => {
    seedFresh()

    await saveBotCredential(bot("b1"), fakeApi)
    await deleteBotCredential("b2", fakeApi)

    expect(calls).not.toContain("listBotCredentials")
  })
})

describe("chat destinations pass straight through", () => {
  it("lists without transforming", async () => {
    expect(await listChatDestinations(fakeApi)).toEqual([dest("d1")])
  })

  it("saves and deletes without invalidating", async () => {
    seedFresh()

    await saveChatDestination(dest("d1"), fakeApi)
    await deleteChatDestination("d1", fakeApi)

    expect(calls).toEqual([
      "upsertChatDestination:d1",
      "deleteChatDestination:d1",
    ])
    expect(isStale()).toBe(false)
  })
})

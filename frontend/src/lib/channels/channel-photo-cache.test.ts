import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { api } from "@/api"
import {
  __resetChannelPhotoCache,
  getChannelPhotoSrc,
} from "@/lib/channels/channel-photo-cache"

const origFetch = api.fetchChannelPhoto
const origCreate = URL.createObjectURL

beforeEach(() => {
  __resetChannelPhotoCache()
  let n = 0
  URL.createObjectURL = mock(() => `blob:mock-${n++}`)
})

afterEach(() => {
  api.fetchChannelPhoto = origFetch
  URL.createObjectURL = origCreate
})

describe("getChannelPhotoSrc", () => {
  test("returns null for a channel with no photo (no fetch)", async () => {
    const spy = mock(async () => new Blob())
    api.fetchChannelPhoto = spy
    expect(await getChannelPhotoSrc("c1", undefined)).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  test("uses an external http url directly, without fetching", async () => {
    const spy = mock(async () => new Blob())
    api.fetchChannelPhoto = spy
    const src = await getChannelPhotoSrc("c2", "https://cdn.example/pic.jpg")
    expect(src).toBe("https://cdn.example/pic.jpg")
    expect(spy).not.toHaveBeenCalled()
  })

  test("fetches a backend blob once and shares it across callers", async () => {
    const spy = mock(async () => new Blob())
    api.fetchChannelPhoto = spy
    const url = "/api/v1/telegram/channel-photo/c3"

    const [a, b] = await Promise.all([
      getChannelPhotoSrc("c3", url),
      getChannelPhotoSrc("c3", url),
    ])
    const c = await getChannelPhotoSrc("c3", url)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(a).toBe(c)
    expect(a).toStartWith("blob:")
  })

  test("re-fetches when the photoUrl changes for the same channel", async () => {
    const spy = mock(async () => new Blob())
    api.fetchChannelPhoto = spy
    await getChannelPhotoSrc("c4", "/api/v1/telegram/channel-photo/c4?v=1")
    await getChannelPhotoSrc("c4", "/api/v1/telegram/channel-photo/c4?v=2")
    expect(spy).toHaveBeenCalledTimes(2)
  })

  test("evicts on failure so a later call retries", async () => {
    let calls = 0
    api.fetchChannelPhoto = mock(async () => {
      calls++
      if (calls === 1) throw new Error("boom")
      return new Blob()
    })
    const url = "/api/v1/telegram/channel-photo/c5"

    await expect(getChannelPhotoSrc("c5", url)).rejects.toThrow("boom")
    const retry = await getChannelPhotoSrc("c5", url)

    expect(calls).toBe(2)
    expect(retry).toStartWith("blob:")
  })
})

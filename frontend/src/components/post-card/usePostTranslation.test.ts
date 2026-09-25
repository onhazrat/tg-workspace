/**
 * The Translate button's behaviour on a card, and what the card does on mount
 * with a translation already in the store.
 *
 * The failures pinned here are all quiet ones: a cached translation fetched
 * again (spends the Operator Key on every render of the feed), auto-translate
 * that never fires or shows the original anyway, and a quota refusal toasted
 * twice, once here and once by `TranslationContext`.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import type { Post, PostTranslation } from "@/types"
import {
  type PostTranslationDeps,
  usePostTranslationWith,
} from "./usePostTranslation"

const post: Post = {
  id: 42,
  channelName: "durov",
  text: "salam",
  language: "fa",
  date: "2026-01-02T03:04:05Z",
  timestamp: 0,
}

const cached = (translatedText: string): PostTranslation => ({
  id: "durov_42_English",
  channelName: "durov",
  postId: 42,
  language: "English",
  translatedText,
  timestamp: 1,
})

/**
 * An in-memory store and a translator that records what it was asked. Built
 * once per test, outside the render callback, so every render sees the same
 * function identities the real providers would hand down.
 */
function harness(
  options: {
    autoTranslate?: boolean
    translationEnabled?: boolean
    stored?: PostTranslation
    translate?: () => Promise<string>
  } = {},
) {
  const store = new Map<string, PostTranslation>()
  if (options.stored) store.set("durov#42", options.stored)
  const reads: string[] = []
  const requests: Array<[string, string]> = []
  const deps: PostTranslationDeps = {
    translationEnabled: options.translationEnabled ?? true,
    autoTranslate: options.autoTranslate ?? false,
    translationTargetLanguage: "English",
    requestTranslation: (id, text) => {
      requests.push([id, text])
      return options.translate ? options.translate() : Promise.resolve("hello")
    },
    getTranslation: async (channelName, postId, language) => {
      reads.push(`${channelName}#${postId}@${language}`)
      return store.get(`${channelName}#${postId}`)
    },
    saveTranslation: async (row) => {
      store.set(`${row.channelName}#${row.postId}`, row)
    },
  }
  const hook = renderHook(
    ({ post, language }: { post: Post; language: string }) =>
      usePostTranslationWith(post, {
        ...deps,
        translationTargetLanguage: language,
      }),
    { initialProps: { post, language: "English" } },
  )
  return { ...hook, store, reads, requests }
}

let toastError: ReturnType<typeof spyOn>
let consoleError: ReturnType<typeof spyOn>
beforeEach(() => {
  toastError = spyOn(toast, "error")
  consoleError = spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  toastError.mockRestore()
  consoleError.mockRestore()
})

describe("toggle", () => {
  test("fetches once, shows the result and stores it under the target language", async () => {
    const { result, store, requests } = harness()
    await waitFor(() => expect(result.current.translatable).toBe(true))

    await act(() => result.current.toggle())

    expect(requests).toEqual([["durov_42", "salam"]])
    expect(result.current.showing).toBe(true)
    expect(result.current.text).toBe("hello")
    expect(store.get("durov#42")).toMatchObject({
      id: "durov_42_English",
      language: "English",
      translatedText: "hello",
    })
  })

  test("after the first fetch it only hides and shows, without asking again", async () => {
    const { result, requests } = harness()
    await act(() => result.current.toggle())

    await act(() => result.current.toggle())
    expect(result.current.showing).toBe(false)
    expect(result.current.text).toBe("salam")

    await act(() => result.current.toggle())
    expect(result.current.text).toBe("hello")
    expect(requests).toHaveLength(1)
  })

  test("a click while the first request is in flight is ignored", async () => {
    let finish: (text: string) => void = () => {}
    const { result, requests } = harness({
      translate: () => new Promise((resolve) => (finish = resolve)),
    })
    act(() => void result.current.toggle())
    await waitFor(() => expect(result.current.busy).toBe(true))

    await act(() => result.current.toggle())
    expect(requests).toHaveLength(1)

    await act(async () => finish("hello"))
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(result.current.text).toBe("hello")
  })

  test("a failure toasts and leaves the original on screen", async () => {
    const { result } = harness({
      translate: () => Promise.reject(new Error("network down")),
    })
    await act(() => result.current.toggle())

    expect(toastError).toHaveBeenCalledWith("Failed to translate post")
    expect(result.current.busy).toBe(false)
    expect(result.current.showing).toBe(false)
    expect(result.current.text).toBe("salam")
  })

  test("a quota refusal is left to TranslationContext, which already said so", async () => {
    const { result } = harness({
      translate: () => Promise.reject(new Error("Quota exceeded")),
    })
    await act(() => result.current.toggle())

    expect(toastError).not.toHaveBeenCalled()
    expect(result.current.busy).toBe(false)
  })
})

describe("on mount", () => {
  test("a stored translation is shown at once with auto-translate on", async () => {
    const { result, requests } = harness({
      autoTranslate: true,
      stored: cached("from the store"),
    })
    await waitFor(() => expect(result.current.text).toBe("from the store"))
    expect(result.current.showing).toBe(true)
    expect(requests).toEqual([])
  })

  test("a stored translation waits for a click without auto-translate, and the click does not refetch", async () => {
    const { result, reads, requests } = harness({
      stored: cached("from the store"),
    })
    await waitFor(() => expect(reads.length).toBeGreaterThan(0))
    expect(result.current.showing).toBe(false)
    expect(result.current.text).toBe("salam")

    await act(() => result.current.toggle())
    expect(result.current.text).toBe("from the store")
    expect(requests).toEqual([])
  })

  test("nothing stored and auto-translate on fetches exactly once", async () => {
    const { result, reads, requests } = harness({ autoTranslate: true })
    await waitFor(() => expect(result.current.text).toBe("hello"))
    expect(result.current.showing).toBe(true)
    expect(requests).toHaveLength(1)
    // The fetch flips `busy`; that must not send the mount read round again.
    expect(reads).toHaveLength(1)
  })

  test("nothing stored and auto-translate off asks the translator for nothing", async () => {
    const { result, reads, requests } = harness()
    await waitFor(() => expect(reads.length).toBeGreaterThan(0))
    expect(requests).toEqual([])
    expect(result.current.text).toBe("salam")
  })

  test("translation switched off reads nothing from the store", async () => {
    const { result, reads } = harness({
      autoTranslate: true,
      translationEnabled: false,
    })
    expect(result.current.translatable).toBe(false)
    await act(async () => {})
    expect(reads).toEqual([])
  })

  test("clicking toggle twice does not read the store again", async () => {
    const { result, reads } = harness({ stored: cached("from the store") })
    await waitFor(() => expect(reads).toEqual(["durov#42@English"]))

    await act(() => result.current.toggle())
    expect(result.current.text).toBe("from the store")
    await act(() => result.current.toggle())
    expect(result.current.text).toBe("salam")

    expect(reads).toEqual(["durov#42@English"])
  })

  test("a different post or target language reads the store again", async () => {
    const { rerender, reads } = harness()
    await waitFor(() => expect(reads).toHaveLength(1))

    rerender({ post: { ...post, id: 43 }, language: "English" })
    await waitFor(() => expect(reads).toHaveLength(2))

    rerender({ post: { ...post, id: 43 }, language: "German" })
    await waitFor(() => expect(reads).toHaveLength(3))
    expect(reads).toEqual([
      "durov#42@English",
      "durov#43@English",
      "durov#43@German",
    ])
  })
})

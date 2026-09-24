import { describe, expect, it } from "bun:test"
import type { Channel, TagRun } from "@/types"
import {
  applicableSuggestions,
  appliedTagsMessage,
  completedTagRun,
  parsePastedTagSuggestions,
  pendingTagRun,
  tagRunSnapshot,
} from "./tag-run"

/** The rules `TagContext`'s run actions used to hold inline. */

const run = (over: Partial<TagRun>): TagRun =>
  ({
    id: "r1",
    status: "completed",
    source: "pasted",
    mode: "add",
    model: "gemini-x",
    createdAt: 0,
    updatedAt: 0,
    postCount: 1,
    ...over,
  }) as TagRun

const channels = [{ id: "alpha", name: "alpha", tags: [] }] as Channel[]

describe("tagRunSnapshot", () => {
  const context = { includeBio: true, includeTags: false }

  it("records the vocabulary as a list, and an empty one as none", () => {
    expect(tagRunSnapshot("News, Tech", context)).toEqual({
      allTagsSnapshot: ["News", "Tech"],
      channelContextOptions: context,
    })
    expect(tagRunSnapshot("(none yet)", context).allTagsSnapshot).toEqual([])
  })
})

describe("pendingTagRun", () => {
  it("prefers a pending run over the one on screen", () => {
    const open = run({ id: "p", status: "pending" })
    expect(pendingTagRun([run({}), open], run({ id: "s" }))?.id).toBe("p")
  })

  it("falls back to the run on screen, else nothing", () => {
    expect(pendingTagRun([run({})], run({ id: "s" }))?.id).toBe("s")
    expect(pendingTagRun([], null)).toBeNull()
  })
})

describe("parsePastedTagSuggestions", () => {
  it("keeps the suggestions for channels you have", () => {
    expect(parsePastedTagSuggestions('{"@alpha": ["News"]}', channels)).toEqual(
      { alpha: ["News"] },
    )
  })

  it("refuses a response that names none of your channels", () => {
    expect(() =>
      parsePastedTagSuggestions('{"stranger": ["News"]}', channels),
    ).toThrow("No channel names in the response matched your channels.")
  })
})

describe("completedTagRun", () => {
  const pending = run({ status: "pending", model: "gemini-x" })

  it("completes the run with the trimmed response", () => {
    expect(
      completedTagRun(pending, "  {} \n", { alpha: ["News"] }, undefined, 9),
    ).toMatchObject({
      id: "r1",
      status: "completed",
      responseText: "{}",
      suggestions: { alpha: ["News"] },
      model: "gemini-x",
      updatedAt: 9,
    })
  })

  it("prefers a typed model, then the run's, then external", () => {
    expect(completedTagRun(pending, "", {}, " gpt ", 0).model).toBe("gpt")
    expect(
      completedTagRun({ ...pending, model: "" }, "", {}, " ", 0).model,
    ).toBe("external")
  })
})

describe("applicableSuggestions", () => {
  it("applies the saved suggestions over the live ones", () => {
    const saved = run({ suggestions: { alpha: ["A"] } })
    expect(applicableSuggestions(saved, { alpha: ["B"] })).toEqual({
      run: saved,
      suggestions: { alpha: ["A"] },
    })
  })

  it("falls back to the live suggestions for a run that saved none", () => {
    const bare = run({})
    expect(applicableSuggestions(bare, { alpha: ["B"] })?.suggestions).toEqual({
      alpha: ["B"],
    })
  })

  it("has nothing to apply with no run or no suggestions", () => {
    expect(applicableSuggestions(null, { alpha: ["B"] })).toBeNull()
    expect(applicableSuggestions(run({}), {})).toBeNull()
  })
})

it("appliedTagsMessage names what the mode did", () => {
  const result = { channelsUpdated: 2, tagsAdded: 3, tagsRemoved: 4 }
  expect(appliedTagsMessage("add", result)).toBe("Added 3 tags to 2 channels.")
  expect(appliedTagsMessage("remove", result)).toBe(
    "Removed 4 tags from 2 channels.",
  )
})

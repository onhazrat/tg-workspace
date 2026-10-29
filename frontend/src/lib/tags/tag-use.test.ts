import { expect, test } from "bun:test"
import { byTagUse, mergeText, newTagValues } from "./tag-use"

const tag = (name: string, channels: number) => ({ name, channels })

test("the most used Tag comes first, then the most channels, then the name", () => {
  const scores: Record<string, number> = { daily: 2.5, weekly: 0.4 }
  const tags = [
    tag("big", 900),
    tag("Alpha", 3),
    tag("weekly", 1),
    tag("beta", 3),
    tag("daily", 2),
  ]
  expect(
    byTagUse(
      tags,
      (name) => scores[name] ?? 0,
      (t) => t.name,
      (t) => t.channels,
    ).map((t) => t.name),
  ).toEqual(["daily", "weekly", "big", "Alpha", "beta"])
})

test("a rename asks first only onto another Tag's name", () => {
  const tags = [tag("news", 4), tag("World", 7)]
  expect(mergeText(tags, "news", "Headlines")).toBeUndefined()
  expect(mergeText(tags, "news", "NEWS")).toBeUndefined()
  expect(mergeText(tags, "news", "world")).toBe(
    '"World" is already a Tag, on 7 channels. Renaming "news" to it merges the two: its 4 channels get "World", and they can\'t be split apart again.',
  )
})

test("the Tag values a filter names that it did not before", () => {
  const atom = (type: string, value: string) => ({
    kind: "atom" as const,
    id: `${type}:${value}`,
    cond: { type, value },
  })
  const root = (...children: ReturnType<typeof atom>[]) => ({
    kind: "group" as const,
    id: "root",
    op: "and" as const,
    children,
  })
  const before = root(atom("tag", "news"))
  const after = root(
    atom("tag", "news"),
    atom("group", "g1"),
    atom("tag", "world"),
    atom("tag", "__ui_untagged__"),
  )
  expect(newTagValues(before, after)).toEqual(["world", "__ui_untagged__"])
  expect(newTagValues(after, before)).toEqual([])
})

/**
 * What the Directory's condition picker offers (DPF): every column a reader
 * may see, and the probe queue's internals only to a `DATA_ADMIN` reader,
 * whose sort or Condition the server refuses to anybody else.
 */
import { describe, expect, test } from "bun:test"
import { directoryVocabulary } from "./directory-vocabulary"

const ids = (internals: boolean) =>
  directoryVocabulary(
    [],
    () => null,
    { ticked: [], selection: [], follows: [] },
    undefined,
    () => null,
    internals,
  ).sections.flatMap((s) => s.entries.map((e) => e.id))

describe("the picker", () => {
  test("offers every reader the columns it may see", () => {
    const offered = ids(false)
    for (const id of [
      "status",
      "measure:sample_count",
      "time:last_post_at",
      "time:created_at",
      "time:checked_at",
      "time:refresh_due_at",
    ])
      expect(offered).toContain(id)
  })

  test("offers the internals to a DATA_ADMIN reader only", () => {
    const internal = [
      "kind",
      "contains",
      "time:attempted_at",
      "time:retry_after",
      "measure:attempts",
      "measure:priority",
      "measure:priority_boost",
      "measure:effective_priority",
      "measure:telegram_chat_id",
      "measure:latest_id",
    ]
    for (const id of internal) {
      expect(ids(false)).not.toContain(id)
      expect(ids(true)).toContain(id)
    }
  })
})

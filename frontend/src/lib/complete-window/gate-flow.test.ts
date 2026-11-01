/**
 * The gate's wait on a sync it joined ends on that Channel's change (WR-02):
 * no poll, the check asked for the changed Channel alone.
 */
import { expect, test } from "bun:test"

import { type GateIO, gateFlow, registerAction, runGated } from "./gate-flow"
import type { Change } from "./live"
import { verdict, windowCheck } from "./verdict-fixtures"

const E = Date.UTC(2026, 10, 1, 9)
const ticks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

// Mutation: merge nothing on a change and the wait never ends, so this times out.
test("the wait on a joined sync ends the moment its Channel lands", async () => {
  let syncing = true
  const asked: string[][] = []
  let hear: ((change: Change) => void) | undefined
  const io: GateIO = {
    names: () => ["a", "b"],
    window: () => ({}) as ReturnType<GateIO["window"]>,
    cached: () => undefined,
    check: async (names) => {
      asked.push(names)
      return windowCheck(
        names.map((n) =>
          n === "a" && syncing
            ? verdict(n, {
                reasons: ["end"],
                reason: "end",
                unprovenPosts: 3,
                syncingSince: E,
              })
            : verdict(n),
        ),
        { end: E },
      )
    },
    sync: async () => {},
    synced: () => {},
    narrow: () => () => {},
    unfreeze: async () => null,
    changes: (listener) => {
      hear = listener
      return () => {
        hear = undefined
      }
    },
  }
  let ran = false
  registerAction("summary", () => {
    ran = true
  })
  runGated("summary")
  const flow = gateFlow(io)

  await flow.begin("summary")
  const done = flow.sync()
  await ticks()
  expect(ran).toBe(false)

  syncing = false
  hear?.(["a"])
  await done

  expect(ran).toBe(true)
  expect(asked).toContainEqual(["a"])
  expect(hear).toBeUndefined()
})

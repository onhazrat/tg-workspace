import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  estimatedViews,
  type ViewCurve,
  type ViewEstimate,
} from "@/lib/posts/estimated-views"

/**
 * The browser's copy of the Estimated View count, against the one fixture the
 * Python reach function and the SQL expression are asserted against too
 * (`backend/tests/services/test_estimated_views.py`, PFB-03, ADR-025).
 *
 * Watched to fail: the raw share instead of the anchored one; `>` for `>=`
 * at either boundary; linear rather than log age between knots.
 */

interface FixtureCase {
  name: string
  views: number | null
  ageHours: number | null
  curve: string
  settings: { settlingAgeHours: number; estimationFloorHours: number }
  expected: number | null
}

const FIXTURE: {
  curves: Record<string, ViewCurve>
  cases: FixtureCase[]
} = JSON.parse(
  readFileSync(
    join(
      import.meta.dir,
      "../../../../backend/tests/fixtures/estimated_views.json",
    ),
    "utf8",
  ),
)

const estimate = (c: FixtureCase, curve: ViewCurve): ViewEstimate => ({
  curve,
  ...c.settings,
})

describe("estimatedViews matches the shared fixture", () => {
  for (const c of FIXTURE.cases) {
    test(c.name, () => {
      const got = estimatedViews(
        c.views,
        c.ageHours,
        estimate(c, FIXTURE.curves[c.curve]),
      )
      if (c.expected == null) expect(got).toBeNull()
      else expect(got).toBeCloseTo(c.expected, 6)
    })
  }

  test("a wrong curve fails the fixture", () => {
    const wrong: ViewCurve = {
      kind: "steps" as const,
      points: [
        [0, 0.5],
        [12, 0.9],
      ],
    }
    const mismatches = FIXTURE.cases.filter((c) => {
      if (c.expected == null || c.expected === c.views) return false
      const got = estimatedViews(c.views, c.ageHours, estimate(c, wrong))
      return got == null || Math.abs(got - c.expected) > 1e-6
    })
    expect(mismatches.length).toBeGreaterThan(0)
  })
})

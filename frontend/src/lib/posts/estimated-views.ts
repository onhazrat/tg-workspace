/**
 * The Estimated View count, in the browser (PFB-03, ADR-025).
 *
 * The third copy of one formula: `backend/app/services/reach.py::estimated_views`
 * is the first, `post_filters.estimated_views_sql` the second, and all three
 * are held to `backend/tests/fixtures/estimated_views.json`. This one exists
 * for semantic results, which the browser filters and orders itself; the
 * server hands it the curve and settings (`GET /data/posts/view-estimate`).
 */
import type { Post } from "@/types"

/** A Settling curve as data: the seed's steps or a fit's log-log knots. */
export interface ViewCurve {
  kind: string
  points: number[][]
}

/** Everything an estimate is read through. */
export interface ViewEstimate {
  curve: ViewCurve
  settlingAgeHours: number
  estimationFloorHours: number
}

/** What a views threshold and the views orders compare. */
export type ViewMeasure = "views" | "estimated"

const MS_PER_HOUR = 3_600_000

/** The share of the step whose range holds the age, the first below it. */
function stepShare(points: number[][], age: number): number {
  let share = points[0][1]
  for (const [start, value] of points) if (age >= start) share = value
  return share
}

/** `np.interp` over log age and log share, flat outside the knots. */
function knotShare(points: number[][], age: number): number {
  const at = Math.log(Math.max(age, points[0][0]))
  const last = points[points.length - 1]
  if (at >= Math.log(last[0])) return last[1]
  for (let i = 0; i < points.length - 1; i++) {
    const [a0, s0] = points[i]
    const [a1, s1] = points[i + 1]
    if (at < Math.log(a1)) {
      const t = (at - Math.log(a0)) / (Math.log(a1) - Math.log(a0))
      return Math.exp(Math.log(s0) + t * (Math.log(s1) - Math.log(s0)))
    }
  }
  return last[1]
}

function share(curve: ViewCurve, age: number): number {
  return curve.kind === "knots"
    ? knotShare(curve.points, age)
    : stepShare(curve.points, age)
}

/** One count at one age; `null` when there is none or it is too new to judge. */
export function estimatedViews(
  views: number | null | undefined,
  ageHours: number | null | undefined,
  estimate: ViewEstimate,
): number | null {
  if (views == null || ageHours == null) return null
  if (ageHours < estimate.estimationFloorHours) return null
  if (ageHours >= estimate.settlingAgeHours) return views
  return (
    (views * share(estimate.curve, estimate.settlingAgeHours)) /
    share(estimate.curve, ageHours)
  )
}

/**
 * A Post's value under the measure, `null` for none. An Estimated View count
 * with no curve loaded yet is none, never a guess.
 */
export function postViewValue(
  post: Post,
  measure: ViewMeasure,
  estimate: ViewEstimate | null | undefined,
): number | null {
  if (measure === "views") return post.viewsCount ?? null
  if (!estimate || post.viewsObservedAt == null) return null
  return estimatedViews(
    post.viewsCount,
    (post.viewsObservedAt - post.timestamp) / MS_PER_HOUR,
    estimate,
  )
}

import { describe, expect, it } from "bun:test"

import { artifactWindowText } from "./artifact-scope"

const local = (
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
): number => new Date(y, m - 1, d, h, min).getTime()

const withWindow = (start: number, end: number) => ({
  scope: { channels: [], start, end },
})

describe("artifactWindowText", () => {
  it("states both exact local boundaries and the derived duration", () => {
    expect(
      artifactWindowText(
        withWindow(local(2026, 7, 24, 23, 54), local(2026, 7, 25, 5, 24)),
        "en-GB",
      ),
    ).toBe("24 Jul 2026, 23:54 – 25 Jul 2026, 5:24 · 5h 30m")
  })

  it("derives duration from the boundaries, not from durationMinutes", () => {
    // A stored projection that disagrees with the pair beside it would put two
    // different answers on one line. The boundaries are the Artifact.
    const artifact = {
      scope: {
        channels: [],
        start: local(2026, 7, 24, 0, 0),
        end: local(2026, 7, 25, 0, 0),
        durationMinutes: 7,
      },
    }
    expect(artifactWindowText(artifact, "en-GB")).toContain("· 1d")
  })

  it("says nothing at all for an Artifact that records no Scope", () => {
    // A legacy `PUT` opened rows with no window. Inventing one here would be a
    // claim about which Posts produced the result.
    expect(artifactWindowText({ scope: null })).toBeNull()
    expect(artifactWindowText(null)).toBeNull()
  })

  it("treats a zero-width window as no window", () => {
    // `(0, 0)` is what a legacy write door could leave behind, and AW-02
    // refuses it. Restoring it would put the workspace on one minute at the
    // epoch, so the caller must not be offered the action.
    expect(
      artifactWindowText({ scope: { channels: [], start: 0, end: 0 } }),
    ).toBeNull()
  })
})

/**
 * A Chat's and a Tag run's Scope line carry the "N missing" chip (ADR-038):
 * absent at zero, after the window otherwise, explained on tap. The Chat's
 * count is its newest answer's. Rendered from props, so no providers.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { FrozenScope } from "@/client"
import { newestMissingPosts } from "@/components/chat/chat-view-model"
import type { ChatMessage, TagRun } from "@/types"
import { ArtifactScopeLineView } from "./ArtifactScopeLine"

afterEach(cleanup)

const scope = {
  channels: ["news"],
  start: Date.UTC(2026, 9, 7, 6),
  end: Date.UTC(2026, 9, 7, 9),
  scopedPostCount: 40,
} as FrozenScope

const line = (missingPosts: number | undefined) =>
  render(
    <ArtifactScopeLineView
      artifact={{ scope }}
      missingPosts={missingPosts}
      onUseScope={mock()}
    />,
  )

describe("a Chat's Scope line", () => {
  test("counts what its newest answer left out", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "q1" },
      { role: "model", text: "a1", missingPosts: 9 },
      { role: "user", text: "q2" },
      { role: "model", text: "a2", missingPosts: 2 },
    ]
    line(newestMissingPosts(messages))
    expect(screen.getByTestId("missing-posts-chip").textContent).toBe(
      "2 missing",
    )

    fireEvent.click(screen.getByTestId("missing-posts-chip"))
    expect(
      screen.getByTestId("missing-posts-explanation").textContent,
    ).toStartWith("2 Covered Posts of 40 are missing.")
  })

  test("shows no chip when the newest answer missed nothing", () => {
    const messages: ChatMessage[] = [
      { role: "model", text: "a1", missingPosts: 9 },
      { role: "user", text: "q2" },
      { role: "model", text: "a2" },
    ]
    line(newestMissingPosts(messages))
    expect(screen.queryByTestId("missing-posts-chip")).toBeNull()
    expect(screen.getByTestId("artifact-scope-line").textContent).toContain(
      "3h",
    )
  })
})

describe("a Tag run's Scope line", () => {
  test("carries the run's count after the window", () => {
    const run = { id: "r1", scope, missingPosts: 5 } as TagRun
    line(run.missingPosts)
    expect(screen.getByTestId("missing-posts-chip").textContent).toBe(
      "5 missing",
    )
  })

  test("shows no chip for a run that missed nothing", () => {
    line(({ id: "r1", scope } as TagRun).missingPosts)
    expect(screen.queryByTestId("missing-posts-chip")).toBeNull()
  })
})

import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { DiscoverScopeCard } from "./DiscoverScopeCard"

describe("DiscoverScopeCard", () => {
  // The report branch mounts ArtifactScopeLine, which needs the app's
  // providers, so only the no-report state renders here.
  const card = (liveChannelCount: number) =>
    renderToStaticMarkup(
      <DiscoverScopeCard
        view={null}
        liveChannelCount={liveChannelCount}
        candidateCount={0}
        unfollowedCount={0}
      />,
    )

  test("before any report, describes the live selection", () => {
    expect(card(2)).toContain("Discovery Scope")
    expect(card(2)).toContain("2 channels selected")
    expect(card(1)).toContain("1 channel selected")
  })
})

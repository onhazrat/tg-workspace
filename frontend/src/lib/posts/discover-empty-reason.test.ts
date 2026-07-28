import { describe, expect, test } from "bun:test"
import {
  type DiscoverySignalKind,
  deriveDiscoveryEmptyReason,
} from "./discover-candidates"

/*
 * The former "parity with computeDiscoveryCandidates" cases are gone with that
 * function: the aggregation is server-side only now, so this helper is the sole
 * source of the empty reason rather than a restatement of one embedded in a
 * client-side aggregation (IDEA-011 D14).
 */

const ALL_KINDS = new Set<DiscoverySignalKind>(["forward", "mention", "link"])
const FORWARD_ONLY = new Set<DiscoverySignalKind>(["forward"])

describe("deriveDiscoveryEmptyReason", () => {
  test("no signals wins over everything", () => {
    expect(
      deriveDiscoveryEmptyReason({
        enabledKinds: new Set(),
        selectedChannelCount: 0,
        postsInScope: 0,
        candidateCount: 0,
        forwardedFilter: "all",
      }),
    ).toBe("no_signals_enabled")
  })

  test("no channels before no posts", () => {
    expect(
      deriveDiscoveryEmptyReason({
        enabledKinds: ALL_KINDS,
        selectedChannelCount: 0,
        postsInScope: 0,
        candidateCount: 0,
        forwardedFilter: "all",
      }),
    ).toBe("no_channels_selected")
  })

  test("no posts in scope", () => {
    expect(
      deriveDiscoveryEmptyReason({
        enabledKinds: ALL_KINDS,
        selectedChannelCount: 2,
        postsInScope: 0,
        candidateCount: 0,
        forwardedFilter: "all",
      }),
    ).toBe("no_posts_in_scope")
  })

  test("original_only only when forwards are the sole signal + original filter", () => {
    expect(
      deriveDiscoveryEmptyReason({
        enabledKinds: FORWARD_ONLY,
        selectedChannelCount: 1,
        postsInScope: 5,
        candidateCount: 0,
        forwardedFilter: "original",
      }),
    ).toBe("original_only")
  })

  test("no_candidates when posts exist but reference nothing", () => {
    expect(
      deriveDiscoveryEmptyReason({
        enabledKinds: ALL_KINDS,
        selectedChannelCount: 1,
        postsInScope: 5,
        candidateCount: 0,
        forwardedFilter: "all",
      }),
    ).toBe("no_candidates")
  })

  test("undefined when candidates exist", () => {
    expect(
      deriveDiscoveryEmptyReason({
        enabledKinds: ALL_KINDS,
        selectedChannelCount: 1,
        postsInScope: 5,
        candidateCount: 3,
        forwardedFilter: "all",
      }),
    ).toBeUndefined()
  })
})

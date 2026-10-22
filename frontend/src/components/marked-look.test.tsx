/**
 * One marked look (KM-03, ADR-034): a ticked Directory entry, a ticked
 * Candidate and a selected Channel carry `data-marked`, which `index.css`
 * gives one blue tint and edge. A followed Candidate's box is checked but is
 * no Tick, so it is not marked. The Highlight stays its own ring.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import type { DirectoryRowResponse } from "@/client"
import { type CardFieldSettings, cardFace } from "@/lib/channels/card-zoom"
import type { DiscoveryCandidate } from "@/lib/posts/discover-candidates"
import type { Channel } from "@/types"
import { ChannelCardFace } from "./channel-card/ChannelCardFace"
import { ChannelCardTile } from "./channel-card/ChannelCardTile"
import { DirectoryTable } from "./directory/DirectoryTable"
import { DiscoverCandidateTable } from "./discover/DiscoverCandidateTable"

afterEach(cleanup)

const marked = () =>
  Array.from(document.querySelectorAll("[data-marked]")).map(
    (el) =>
      el.getAttribute("data-channel-name") ??
      el.getAttribute("data-directory-handle") ??
      el.getAttribute("data-discover-handle"),
  )

const settings = {
  showChannelBio: false,
  showChannelSubscribers: false,
  showChannelTelegramChatId: false,
  showChannelPhotos: false,
  showChannelVideos: false,
  showChannelFiles: false,
  showChannelLinks: false,
  showChannelStartId: false,
} satisfies CardFieldSettings
const channel = (name: string) =>
  ({ id: name, name, displayName: name, tags: [] }) as unknown as Channel

describe("one marked look", () => {
  test("a selected Channel is marked, at every card size", () => {
    const none = () => {}
    render(
      <>
        {[true, false].map((isSelected) => (
          <ChannelCardFace
            key={String(isSelected)}
            channel={channel(isSelected ? "on" : "off")}
            stats={undefined}
            face={cardFace(2, settings)}
            inScopeCount={0}
            accountChannels={[]}
            onFilterByTag={none}
            isSelected={isSelected}
            isScraping={false}
            busy={false}
            queuePosition={null}
            onToggleSelected={none}
            onToggleFreeze={none}
            onResetAndSync={none}
            onRemove={none}
            onSaveChannel={none}
            onSync={none}
          />
        ))}
        <ChannelCardTile
          channel={channel("tile")}
          isSelected
          isScraping={false}
          busy={false}
          onToggleSelected={none}
          onSync={none}
        />
      </>,
    )
    expect(marked()).toEqual(["on", "tile"])
  })

  test("a ticked Directory entry is marked", () => {
    const row = (handle: string) =>
      ({
        handle,
        displayName: handle,
        tags: [],
        followable: true,
        followed: false,
        dismissed: false,
        match: null,
      }) as unknown as DirectoryRowResponse
    render(
      <DirectoryTable
        rows={[row("a"), row("b")]}
        total={2}
        page={0}
        sort="mine"
        descending
        shown={[]}
        ticks={new Set(["b"])}
        onTicks={() => {}}
        following={new Set()}
        onFollow={() => {}}
        onDismiss={() => {}}
        onSort={() => {}}
        onPage={() => {}}
        onOpen={() => {}}
      />,
    )
    expect(marked()).toEqual(["b"])
  })

  test("a ticked Candidate is marked, a followed one is not", () => {
    const candidate = (name: string, isFollowed: boolean) =>
      ({
        name,
        counts: { forward: 0, mention: 0, link: 0 },
        total: 0,
        seenIn: [],
        lastSeen: 0,
        isFollowed,
        probe: null,
      }) as unknown as DiscoveryCandidate
    render(
      <DiscoverCandidateTable
        candidates={[candidate("a", false), candidate("b", true)]}
        selectedForFollow={new Set(["a"])}
        setSelectedForFollow={() => {}}
        unfollowedCount={1}
        isOffline={false}
        isFollowJobRunning={false}
        activeFollowNames={[]}
        syncingNames={new Set()}
        resultStatusByName={new Map()}
        onFollow={() => {}}
        onInspect={() => {}}
        onSetIgnored={() => {}}
        onRecheck={() => {}}
        isRecheckPending={false}
        weights={{ forward: 1, mention: 1, link: 1 }}
        showScore={false}
      />,
    )
    expect(
      (screen.getByTestId("discover-select-b") as HTMLInputElement).checked,
    ).toBe(true)
    expect(marked()).toEqual(["a"])
  })
})

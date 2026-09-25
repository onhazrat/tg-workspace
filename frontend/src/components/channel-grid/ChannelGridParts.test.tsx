import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import type React from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { Channel } from "@/types"
import { ChannelGridBody } from "./ChannelGridBody"
import { ChannelGridDialogs } from "./ChannelGridDialogs"
import { ChannelGridFilterBar } from "./ChannelGridFilterBar"

const noop = () => {}

afterEach(cleanup)

describe("ChannelGridBody", () => {
  const body = (over: Partial<React.ComponentProps<typeof ChannelGridBody>>) =>
    renderToStaticMarkup(
      <ChannelGridBody
        isLoading={false}
        totalChannelCount={0}
        filteredChannelCount={0}
        channels={[]}
        visibleCount={0}
        showSortRank={false}
        selectedChannels={new Set()}
        selectedTrimRanks={new Map()}
        postsInScopeCounts={{}}
        onRemoveChannel={noop}
        onResetAndSync={noop}
        hasMore={false}
        onLoadMore={noop}
        scrollContainerRef={{ current: null }}
        {...over}
      />,
    )

  test("shows skeletons while loading, whatever the counts say", () => {
    const html = body({ isLoading: true, totalChannelCount: 5 })
    expect(html).toContain('data-slot="skeleton"')
    expect(html).not.toContain("No Channels Found")
  })

  test("tells an empty account to add a channel", () => {
    expect(body({})).toContain("Start by adding a Telegram channel")
  })

  test("tells a filtered-out account its search matched nothing", () => {
    const html = body({ totalChannelCount: 4 })
    expect(html).toContain("No channels match your search.")
    expect(html).not.toContain("Start by adding")
  })
})

describe("ChannelGridDialogs", () => {
  test("renders nothing while nothing is pending", () => {
    const html = renderToStaticMarkup(
      <ChannelGridDialogs
        confirmResetModal={null}
        onCloseResetModal={noop}
        onConfirmResetAndSync={noop}
        confirmDeleteChannel={null}
        onCloseDeleteChannel={noop}
        onConfirmDeleteChannel={noop}
        confirmBulkDelete={false}
        onBulkDeleteOpenChange={noop}
        onConfirmBulkDelete={noop}
        selectedCount={0}
        confirmBulkFreezeAction={null}
        onCloseBulkFreezeAction={noop}
        onConfirmBulkFreezeAction={noop}
      />,
    )
    expect(html).toBe("")
  })

  test("names the pending channel and count in each open dialog", () => {
    // Radix portals an open dialog, so this needs a DOM, not static markup.
    render(
      <ChannelGridDialogs
        confirmResetModal={{ name: "carrier", startId: 42 } as Channel}
        onCloseResetModal={noop}
        onConfirmResetAndSync={noop}
        confirmDeleteChannel={{ name: "gone" } as Channel}
        onCloseDeleteChannel={noop}
        onConfirmDeleteChannel={noop}
        confirmBulkDelete
        onBulkDeleteOpenChange={noop}
        onConfirmBulkDelete={noop}
        selectedCount={3}
        confirmBulkFreezeAction="freeze"
        onCloseBulkFreezeAction={noop}
        onConfirmBulkFreezeAction={noop}
      />,
    )
    expect(
      screen.getByText("Clear all posts for @carrier and re-sync from ID 42?"),
    ).toBeTruthy()
    expect(screen.getByText("@gone")).toBeTruthy()
    expect(screen.getByText("Remove 3 Channels")).toBeTruthy()
    expect(screen.getByText("Freeze Selected Channels?")).toBeTruthy()
  })
})

describe("ChannelGridFilterBar", () => {
  const bar = (
    over: Partial<React.ComponentProps<typeof ChannelGridFilterBar>>,
  ) =>
    renderToStaticMarkup(
      <ChannelGridFilterBar
        includeChannelBioInPrompt={false}
        onIncludeChannelBioInPromptChange={noop}
        includeChannelTagsInPrompt={false}
        onIncludeChannelTagsInPromptChange={noop}
        isFilteringActive={false}
        filteredCount={2}
        totalCount={9}
        allLanguages={[]}
        selectedLanguageFilter=""
        onLanguageFilterChange={noop}
        sortBy="last_updated"
        onSortByChange={noop}
        sortDirection="desc"
        onToggleSortDirection={noop}
        showChannelSubscribers={false}
        trimCount=""
        onTrimCountChange={noop}
        isTrimInputDisabled={false}
        isTrimDisabled={false}
        onTrimSelection={noop}
        showSortRank={false}
        onShowSortRankChange={noop}
        {...over}
      />,
    )

  test("shows the filtered count only while a filter is active", () => {
    expect(bar({})).not.toContain("Showing 2 of 9 channels")
    expect(bar({ isFilteringActive: true })).toContain(
      "Showing 2 of 9 channels",
    )
  })

  test("offers the language filter only when channels report a language", () => {
    expect(bar({})).not.toContain(">Lang<")
    expect(bar({ allLanguages: [{ code: "en", name: "English" }] })).toContain(
      ">Lang<",
    )
  })

  test("labels the sort direction it is in", () => {
    expect(bar({ sortDirection: "asc" })).toContain("Sort Ascending")
    expect(bar({})).toContain("Sort Descending")
  })
})

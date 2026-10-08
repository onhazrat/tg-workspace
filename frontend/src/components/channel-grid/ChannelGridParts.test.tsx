import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import type React from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { Channel } from "@/types"
import { ChannelGridBody } from "./ChannelGridBody"
import { ChannelGridDialogs } from "./ChannelGridDialogs"

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
        showSortRank={false}
        zoom={0}
        selectedChannels={new Set()}
        selectedTrimRanks={new Map()}
        postsInScopeCounts={{}}
        onFilterByTag={noop}
        onRemoveChannel={noop}
        onResetAndSync={noop}
        onSelectChannel={noop}
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
        actionCount={0}
        hiddenNote=""
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
        actionCount={3}
        hiddenNote="40 selected Channels hidden by filters are not affected."
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
    // CTB-04: both bulk confirmations name the Hidden selection they spare.
    expect(
      screen.getAllByText(/40 selected Channels hidden by filters/),
    ).toHaveLength(2)
    expect(screen.getByText(/^Freeze 3 selected channels\./)).toBeTruthy()
  })
})

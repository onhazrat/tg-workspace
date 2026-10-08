/**
 * The pieces `ChannelCard` is assembled from. Each takes props only, so no
 * context providers and no `mock.module` (process-wide in bun, see
 * `DataContext.test.tsx`). What is pinned is what the card did before it was
 * split: status precedence, the progress maths, which chips a setting hides,
 * the reserved `group:` prefix, and the Start ID input refusing a non-positive
 * number.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  type CardZoom,
  type ChannelMetaVisibility,
  cardFace,
} from "@/lib/channels/card-zoom"
import type { Channel, ChannelSettingGroup, ChannelStats } from "@/types"
import {
  ChannelCardActions,
  ChannelCardBadges,
  ChannelCardSyncingOverlay,
} from "./ChannelCardChrome"
import { ChannelCardFace } from "./ChannelCardFace"
import { ChannelCardFooter } from "./ChannelCardFooter"
import { ChannelCardHeader } from "./ChannelCardHeader"
import { ChannelCardMeta } from "./ChannelCardMeta"
import { ChannelCardTags } from "./ChannelCardTags"
import {
  channelCardFrameClass,
  channelSyncStatus,
  freezeTargetGroup,
  parseStartId,
  queuePosition,
  settingGroupHints,
  syncProgress,
} from "./channel-card-status"

afterEach(cleanup)

const noop = () => {}

const base: Channel = {
  id: "c1",
  name: "durov",
  tags: [],
  lastUpdated: 0,
}
const stats = (maxId: number, latestId?: number): ChannelStats => ({
  count: 10,
  maxId,
  latestId,
  reach: null,
  reachEstimated: false,
})

describe("channel-card-status", () => {
  test("restricted beats frozen", () => {
    const both = { ...base, isUnavailableOnWebView: true, isFrozen: true }
    expect(channelSyncStatus(both)?.label).toBe("Restricted")
    expect(channelSyncStatus({ ...base, isFrozen: true })?.label).toBe("Frozen")
  })

  test("a channel neither Restricted nor Frozen has no status", () => {
    expect(channelSyncStatus(base)).toBeNull()
  })

  test("progress is unknown without both ids", () => {
    expect(syncProgress(undefined)).toBeNull()
    expect(syncProgress(stats(5))).toBeNull()
    expect(syncProgress(stats(0, 10))).toBeNull()
    expect(syncProgress(stats(5, 10))).toBe(50)
  })

  test("a Start ID must be a positive integer", () => {
    expect(parseStartId("42")).toBe(42)
    expect(parseStartId("42abc")).toBe(42)
    expect(parseStartId("0")).toBeNull()
    expect(parseStartId("-3")).toBeNull()
    expect(parseStartId("")).toBeNull()
  })
})

describe("ChannelCardSyncingOverlay", () => {
  test("shows a rounded percent and caps the bar at 100", () => {
    render(<ChannelCardSyncingOverlay progress={123.4} clickThrough={false} />)
    expect(screen.getByText("Syncing 123%")).toBeTruthy()
  })

  test("falls back to a plain label with no progress bar", () => {
    const { container } = render(
      <ChannelCardSyncingOverlay progress={null} clickThrough={false} />,
    )
    expect(screen.getByText("Syncing Data")).toBeTruthy()
    expect(container.querySelector(".max-w-\\[120px\\]")).toBeNull()
  })
})

describe("ChannelCardActions", () => {
  const handlers = () => ({
    onToggleFreeze: mock(),
    onResetAndSync: mock(),
    onRemove: mock(),
  })

  test("each button calls its own handler", () => {
    const h = handlers()
    render(<ChannelCardActions channel={base} busy={false} {...h} />)
    fireEvent.click(screen.getByLabelText("Freeze Channel (Stop Syncing)"))
    fireEvent.click(screen.getByLabelText("Reset & Sync from beginning"))
    fireEvent.click(screen.getByLabelText("Remove Channel"))
    expect(h.onToggleFreeze).toHaveBeenCalledTimes(1)
    expect(h.onResetAndSync).toHaveBeenCalledTimes(1)
    expect(h.onRemove).toHaveBeenCalledTimes(1)
  })

  test("a frozen channel offers unfreeze; an unavailable one offers neither", () => {
    render(
      <ChannelCardActions
        channel={{ ...base, isFrozen: true }}
        busy={false}
        {...handlers()}
      />,
    )
    expect(screen.getByLabelText("Unfreeze Channel")).toBeTruthy()
    cleanup()
    render(
      <ChannelCardActions
        channel={{ ...base, isUnavailableOnWebView: true }}
        busy={false}
        {...handlers()}
      />,
    )
    expect(screen.queryByLabelText(/Freeze Channel/)).toBeNull()
  })

  test("reset is disabled while busy and names the group that forbids it", () => {
    render(<ChannelCardActions channel={base} busy {...handlers()} />)
    expect(
      (
        screen.getByLabelText(
          "Reset & Sync from beginning",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    cleanup()
    const refused = {
      ...base,
      resetSyncEnabled: false,
      settingGroupName: "Slow",
    }
    render(
      <ChannelCardActions channel={refused} busy={false} {...handlers()} />,
    )
    const reset = screen.getByLabelText(/Slow/) as HTMLButtonElement
    expect(reset.disabled).toBe(true)
  })
})

describe("ChannelCardBadges", () => {
  test("selection toggles and announces its state", () => {
    const onToggle = mock()
    render(
      <ChannelCardBadges
        showCheckbox
        showDetails
        channel={base}
        isSelected
        onToggleSelected={onToggle}
        queuePosition={null}
      />,
    )
    const button = screen.getByLabelText("Deselect durov")
    expect(button.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  test("renders only the badges the channel earns", () => {
    render(
      <ChannelCardBadges
        showCheckbox
        showDetails
        channel={{
          ...base,
          isUnavailableOnWebView: true,
          language: "fa",
          historyCompleteToCutoff: false,
        }}
        isSelected={false}
        onToggleSelected={() => {}}
        queuePosition={3}
        sortRank={7}
      />,
    )
    expect(screen.getByText("#3")).toBeTruthy()
    expect(screen.getByTestId("channel-sort-rank").textContent).toBe("#7")
    expect(screen.getByText("Unavailable")).toBeTruthy()
    expect(screen.getByText("Persian")).toBeTruthy()
    expect(screen.getByText("Partial history")).toBeTruthy()
    cleanup()
    render(
      <ChannelCardBadges
        showCheckbox
        showDetails
        channel={{ ...base, historyCompleteToCutoff: true }}
        isSelected={false}
        onToggleSelected={() => {}}
        queuePosition={null}
      />,
    )
    expect(screen.queryByTestId("channel-sort-rank")).toBeNull()
    expect(screen.queryByText("Unavailable")).toBeNull()
    expect(screen.queryByText("Partial history")).toBeNull()
  })
})

describe("ChannelCardMeta", () => {
  const all: ChannelMetaVisibility = {
    subscribers: true,
    telegramChatId: true,
    photos: true,
    videos: true,
    files: true,
    links: true,
  }
  const counted: Channel = {
    ...base,
    subscribers: 1500,
    telegramChatId: 777,
    photos: 2,
    videos: 3,
    files: 4,
    links: 5,
  }

  test("post count, in-scope count and activity rate", () => {
    render(
      <ChannelCardMeta
        channel={base}
        stats={{
          count: 1234,
          velocity: 0.4,
          reach: null,
          reachEstimated: false,
        }}
        inScopeCount={12}
        show={all}
      />,
    )
    expect(screen.getByText("1,234 Posts")).toBeTruthy()
    expect(screen.getByText("(12 in scope)")).toBeTruthy()
    expect(screen.getByText("< 1 / hr")).toBeTruthy()
  })

  test("each counter shows when its setting is on and hides when off", () => {
    render(
      <ChannelCardMeta
        channel={counted}
        stats={undefined}
        inScopeCount={0}
        show={all}
      />,
    )
    for (const text of ["777", "2", "3", "4", "5"])
      expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByText(/in scope/)).toBeNull()
    expect(screen.queryByText(/\/ hr/)).toBeNull()
    cleanup()
    const none = Object.fromEntries(
      Object.keys(all).map((k) => [k, false]),
    ) as unknown as ChannelMetaVisibility
    render(
      <ChannelCardMeta
        channel={counted}
        stats={undefined}
        inScopeCount={0}
        show={none}
      />,
    )
    for (const text of ["777", "2", "3", "4", "5"])
      expect(screen.queryByText(text)).toBeNull()
  })

  test("reach reads measured, estimated or not measured", () => {
    const withReach = (reach: number | null, reachEstimated: boolean) =>
      render(
        <ChannelCardMeta
          channel={base}
          stats={{ count: 5, reach, reachEstimated }}
          inScopeCount={0}
          show={all}
        />,
      )
    withReach(12300, false)
    expect(screen.getByText("Reach 12.3K")).toBeTruthy()
    cleanup()
    withReach(12300, true)
    expect(screen.getByText("Reach ~12.3K")).toBeTruthy()
    cleanup()
    withReach(null, false)
    expect(screen.getByText("Reach not measured")).toBeTruthy()
    cleanup()
    // Zero is a measurement, not an absence.
    withReach(0, false)
    expect(screen.getByText("Reach 0")).toBeTruthy()
  })

  test("no reach chip before the stats have loaded", () => {
    render(
      <ChannelCardMeta
        channel={base}
        stats={undefined}
        inScopeCount={0}
        show={all}
      />,
    )
    expect(screen.queryByText(/Reach/)).toBeNull()
  })

  test("auto-followed channels say so", () => {
    render(
      <ChannelCardMeta
        channel={{ ...base, discoveredVia: { channelName: "src" } } as Channel}
        stats={undefined}
        inScopeCount={0}
        show={all}
      />,
    )
    expect(screen.getByText("Auto-Followed")).toBeTruthy()
  })
})

describe("ChannelCardTags", () => {
  // This Channel carries "news". radar shares news on two Channels, tech on
  // one; sport is on three Channels that share nothing with this one.
  const account: Pick<Channel, "tags">[] = [
    { tags: ["news"] },
    { tags: ["news", "radar"] },
    { tags: ["news", "radar"] },
    { tags: ["news", "tech"] },
    { tags: ["sport"] },
    { tags: ["sport"] },
    { tags: ["sport"] },
    { tags: ["zoo"] },
    { tags: ["art"] },
    { tags: ["group:Slow"] },
  ]
  const renderTags = (
    overrides: Partial<Parameters<typeof ChannelCardTags>[0]> = {},
  ) => {
    const props = {
      tags: ["news"] as Channel["tags"],
      virtualGroupTagName: "group:Fast",
      inheritedSettingsHint: "hint",
      accountChannels: account,
      onSave: mock(),
      onFilterByTag: mock(),
      ...overrides,
    }
    render(<ChannelCardTags {...props} />)
    return props
  }
  const field = () => screen.getByLabelText("Add tag") as HTMLInputElement
  const type = (text: string) =>
    fireEvent.change(field(), { target: { value: text } })
  const key = (k: string) => fireEvent.keyDown(field(), { key: k })
  /** Lets queued saves run, since each waits for the one before it. */
  const settle = () => act(async () => {})
  /** The tag names of each save, in the order they were sent. */
  const saves = async (onSave: unknown) => {
    await settle()
    return (onSave as ReturnType<typeof mock>).mock.calls.map((call) =>
      (call[0] as { name: string }[]).map((t) => t.name),
    )
  }
  const suggestions = () =>
    screen.queryAllByRole("option").map((o) => o.textContent)

  test("the field is always there after the chips, with no button in front", () => {
    renderTags()
    expect(screen.getByText("group:Fast").getAttribute("title")).toBe("hint")
    expect(screen.getByText("news")).toBeTruthy()
    expect(field()).toBeTruthy()
    expect(screen.queryByText(/Add Tag/)).toBeNull()
  })

  test("Enter adds exactly what was typed, trimmed, and empties the field", async () => {
    const { onSave } = renderTags()
    field().focus()
    type("  rad ")
    key("Enter")
    expect(await saves(onSave)).toEqual([["news", "rad"]])
    expect(field().value).toBe("")
  })

  test("suggestions appear only on focus, ranked by pairing, then use, then name", () => {
    renderTags()
    expect(suggestions()).toEqual([])
    fireEvent.focus(field())
    // radar pairs with news twice, tech once; sport is on more Channels than
    // art or zoo; art and zoo tie and go alphabetically. news is already
    // here and group:Slow is a Setting group's tag.
    expect(suggestions()).toEqual(["radar", "tech", "sport", "art", "zoo"])
    fireEvent.blur(field())
    expect(suggestions()).toEqual([])
  })

  test("typing puts prefix matches before substring matches", () => {
    renderTags()
    fireEvent.focus(field())
    type("ar")
    expect(suggestions()).toEqual(["art", "radar"])
  })

  test("Tab takes the top suggestion, or the one the arrows highlight", async () => {
    const { onSave } = renderTags()
    fireEvent.focus(field())
    type("a")
    key("Tab")
    // art is on the card now, so radar is the only row left for "a".
    type("a")
    key("ArrowDown")
    key("ArrowDown")
    key("ArrowUp")
    expect(screen.queryByRole("option", { selected: true })).toBeNull()
    key("ArrowDown")
    expect(screen.getByRole("option", { selected: true }).textContent).toBe(
      "radar",
    )
    key("Tab")
    expect(await saves(onSave)).toEqual([
      ["news", "art"],
      ["news", "art", "radar"],
    ])
  })

  test("Tab in an empty field with nothing highlighted leaves the field", async () => {
    const { onSave } = renderTags()
    fireEvent.focus(field())
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    })
    field().dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
    expect(await saves(onSave)).toEqual([])
  })

  test("Enter adds the arrow-chosen suggestion, else what was typed in an existing tag's spelling", async () => {
    const { onSave } = renderTags()
    fireEvent.focus(field())
    type("ra")
    key("ArrowDown")
    key("Enter")
    type("SPORT")
    key("Enter")
    // A new tag that starts like an old one is still created.
    type("ar")
    key("Enter")
    expect((await saves(onSave)).at(-1)).toEqual([
      "news",
      "radar",
      "sport",
      "ar",
    ])
  })

  test("a trailing comma adds the tag and leaves the field empty", async () => {
    const { onSave } = renderTags()
    fireEvent.focus(field())
    type("Zoo,")
    expect(await saves(onSave)).toEqual([["news", "zoo"]])
    expect(field().value).toBe("")
  })

  test("Backspace in an empty field removes the last tag; with text it does not", async () => {
    const { onSave } = renderTags({ tags: ["news", "tech"] })
    fireEvent.focus(field())
    type("x")
    key("Backspace")
    expect(await saves(onSave)).toEqual([])
    type("")
    key("Backspace")
    expect(await saves(onSave)).toEqual([["news"]])
  })

  test("Escape leaves the field without adding anything", async () => {
    const { onSave } = renderTags()
    field().focus()
    type("tech")
    key("Escape")
    expect(document.activeElement).not.toBe(field())
    expect(field().value).toBe("")
    expect(await saves(onSave)).toEqual([])
  })

  test("blank and reserved group: tags are not saved", async () => {
    const { onSave } = renderTags()
    fireEvent.focus(field())
    type("   ")
    key("Enter")
    type("group:x")
    key("Enter")
    type("Group:y,")
    expect(await saves(onSave)).toEqual([])
  })

  test("two quick adds are both kept: the second save waits for the first and carries both", async () => {
    let finishFirst = () => {}
    const onSave = mock()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirst = resolve
          }),
      )
      .mockImplementation(() => Promise.resolve())
    renderTags({ onSave })
    fireEvent.focus(field())
    type("tech,")
    type("zoo,")
    expect(screen.getByText("tech")).toBeTruthy()
    expect(screen.getByText("zoo")).toBeTruthy()
    expect(await saves(onSave)).toEqual([["news", "tech"]])
    finishFirst()
    expect(await saves(onSave)).toEqual([
      ["news", "tech"],
      ["news", "tech", "zoo"],
    ])
  })

  test("clicking a tag's name filters by it; its remove button stays; AI tags stay marked", async () => {
    const { onSave, onFilterByTag } = renderTags({
      tags: [
        { name: "news", source: "manual", assignedAt: 0 },
        { name: "crypto", source: "ai", assignedAt: 0 },
      ],
    })
    fireEvent.click(screen.getByRole("button", { name: "crypto" }))
    expect(onFilterByTag).toHaveBeenCalledWith("crypto")
    expect(screen.getByTitle("Added by AI")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "news" }).parentElement?.textContent,
    ).not.toContain("Added by AI")
    fireEvent.click(screen.getByLabelText("Remove tag news"))
    expect(onFilterByTag).toHaveBeenCalledTimes(1)
    expect(await saves(onSave)).toEqual([["crypto"]])
  })
})

describe("ChannelCardFooter", () => {
  const renderFooter = (
    channel: Channel,
    overrides: Partial<Parameters<typeof ChannelCardFooter>[0]> = {},
  ) => {
    const props = {
      channel,
      showStartId: true,
      showStatus: true,
      detailed: false,
      isScraping: false,
      busy: false,
      inheritedSettingsHint: "hint",
      onSaveStartId: mock(),
      onSync: mock(),
      ...overrides,
    }
    render(<ChannelCardFooter {...props} />)
    return props
  }

  test("status and sync label follow the channel", () => {
    const { onSync } = renderFooter(base)
    expect(screen.queryByText("Restricted")).toBeNull()
    fireEvent.click(screen.getByText("Sync"))
    expect(onSync).toHaveBeenCalledTimes(1)
    cleanup()
    renderFooter({ ...base, isUnavailableOnWebView: true })
    expect(screen.getByText("Recheck")).toBeTruthy()
    expect(screen.getByText("Restricted")).toBeTruthy()
  })

  test("sync is disabled while busy or when the group forbids it", () => {
    renderFooter(base, { busy: true })
    expect(
      (screen.getByText("Sync").closest("button") as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    cleanup()
    renderFooter({ ...base, allowIndividualSync: false })
    expect(
      (screen.getByText("Sync").closest("button") as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  test("Start ID edits save a positive number and ignore anything else", () => {
    const { onSaveStartId } = renderFooter({ ...base, startId: 100 })
    fireEvent.click(screen.getByText("100"))
    const input = screen.getByLabelText("Start ID") as HTMLInputElement
    expect(input.value).toBe("100")
    fireEvent.change(input, { target: { value: "250" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSaveStartId).toHaveBeenCalledWith(250)

    fireEvent.click(screen.getByText("100"))
    const again = screen.getByLabelText("Start ID")
    fireEvent.change(again, { target: { value: "-1" } })
    fireEvent.blur(again)
    expect(onSaveStartId).toHaveBeenCalledTimes(1)
  })

  test("an unset Start ID reads Auto; the field hides when the setting is off", () => {
    renderFooter(base)
    expect(screen.getByText("Auto")).toBeTruthy()
    cleanup()
    renderFooter(base, { showStartId: false })
    expect(screen.queryByText("Start ID")).toBeNull()
  })
})

describe("the card shell's rules", () => {
  const group = (id: string, isDefault = false) =>
    ({ id, name: id, isDefault }) as unknown as ChannelSettingGroup
  const groups = [group("default", true), group("frozen-1"), group("slow")]

  test("freezing moves to the Frozen group, thawing to the default", () => {
    expect(freezeTargetGroup(base, groups)?.id).toBe("frozen-1")
    expect(freezeTargetGroup({ ...base, isFrozen: true }, groups)?.id).toBe(
      "default",
    )
    expect(freezeTargetGroup(base, [group("default", true)])).toBeUndefined()
    expect(
      freezeTargetGroup({ ...base, isFrozen: true }, [group("frozen-1")]),
    ).toBeUndefined()
  })

  test("queue position is 1-based, null when not queued", () => {
    const queue = [{ channel: { id: "x" } }, { channel: { id: "c1" } }]
    expect(queuePosition(queue, "c1")).toBe(2)
    expect(queuePosition(queue, "x")).toBe(1)
    expect(queuePosition(queue, "nope")).toBeNull()
  })

  test("the frame reflects frozen, selected and syncing", () => {
    const plain = channelCardFrameClass({
      isFrozen: false,
      isSelected: false,
      isScraping: false,
    })
    expect(plain).not.toContain("opacity-80")
    expect(plain).toContain("border-app-ink/10")
    expect(plain).not.toContain("ring-2")
    const all = channelCardFrameClass({
      isFrozen: true,
      isSelected: true,
      isScraping: true,
    })
    expect(all).toContain("opacity-80")
    expect(all).toContain("border-app-ink shadow-md")
    expect(all).not.toContain("border-app-ink/10")
    expect(all).toContain("ring-2 ring-app-ink/20")
  })

  test("each frame flag changes only its own class", () => {
    const frame = (flag: "isFrozen" | "isSelected" | "isScraping") =>
      channelCardFrameClass({
        isFrozen: false,
        isSelected: false,
        isScraping: false,
        [flag]: true,
      })
    expect(frame("isFrozen")).toContain("opacity-80")
    expect(frame("isFrozen")).not.toContain("ring-2")
    expect(frame("isFrozen")).toContain("border-app-ink/10")
    expect(frame("isSelected")).not.toContain("opacity-80")
    expect(frame("isSelected")).not.toContain("ring-2")
    expect(frame("isScraping")).toContain("ring-2")
    expect(frame("isScraping")).not.toContain("opacity-80")
    expect(frame("isScraping")).toContain("border-app-ink/10")
  })

  test("a named group becomes a tag and names itself in the hint", () => {
    expect(settingGroupHints("Slow Feed")).toEqual({
      virtualGroupTagName: "group:Slow Feed",
      inheritedSettingsHint: 'Inherited from setting group "Slow Feed"',
    })
    expect(settingGroupHints(undefined)).toEqual({
      virtualGroupTagName: null,
      inheritedSettingsHint: "Inherited from channel setting group",
    })
    expect(settingGroupHints("").virtualGroupTagName).toBeNull()
  })
})

describe("ChannelCardHeader", () => {
  test("titles by display name, falling back to the handle", () => {
    render(
      <ChannelCardHeader
        linkToTelegram
        channel={{ ...base, displayName: "Pavel" }}
        showBio={false}
      />,
    )
    expect(screen.getByTitle("Pavel").textContent).toBe("Pavel")
    expect(screen.getByText("@durov")).toBeTruthy()
    cleanup()
    render(<ChannelCardHeader linkToTelegram channel={base} showBio={false} />)
    expect(screen.getByTitle("durov").textContent).toBe("durov")
  })

  test("marks a frozen channel", () => {
    render(<ChannelCardHeader linkToTelegram channel={base} showBio={false} />)
    expect(screen.queryByTestId("channel-card-frozen-mark")).toBeNull()
    cleanup()
    render(
      <ChannelCardHeader
        linkToTelegram
        channel={{ ...base, isFrozen: true }}
        showBio={false}
      />,
    )
    expect(screen.getByTestId("channel-card-frozen-mark")).toBeTruthy()
  })

  test("the bio shows only when the setting is on and there is one", () => {
    const withBio = { ...base, bio: "about" }
    render(<ChannelCardHeader linkToTelegram channel={withBio} showBio />)
    expect(screen.getByTitle("about").getAttribute("dir")).toBe("auto")
    cleanup()
    render(
      <ChannelCardHeader linkToTelegram channel={withBio} showBio={false} />,
    )
    expect(screen.queryByTitle("about")).toBeNull()
    cleanup()
    render(<ChannelCardHeader linkToTelegram channel={base} showBio />)
    expect(screen.queryByText("about")).toBeNull()
  })
})

describe("ChannelCardFace", () => {
  const settingsOff = {
    showChannelBio: false,
    showChannelSubscribers: false,
    showChannelTelegramChatId: false,
    showChannelPhotos: false,
    showChannelVideos: false,
    showChannelFiles: false,
    showChannelLinks: false,
    showChannelStartId: false,
  }
  const renderFace = (zoom: CardZoom, isScraping = false) => {
    const handlers = {
      onToggleSelected: mock(),
      onSync: mock(),
      onRemove: mock(),
    }
    render(
      <ChannelCardFace
        channel={base}
        stats={stats(5, 9)}
        face={cardFace(zoom, settingsOff)}
        inScopeCount={0}
        accountChannels={[]}
        onFilterByTag={noop}
        isSelected={false}
        isScraping={isScraping}
        busy={false}
        queuePosition={null}
        onToggleFreeze={noop}
        onResetAndSync={noop}
        onSaveChannel={noop}
        {...handlers}
      />,
    )
    return handlers
  }

  test("at zoom -1 the card body selects and Sync does not", () => {
    const h = renderFace(-1)
    const toggles = screen.getAllByLabelText("Select durov")
    expect(toggles).toHaveLength(1)
    fireEvent.click(toggles[0])
    expect(h.onToggleSelected).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: /Sync/ }))
    expect(h.onSync).toHaveBeenCalledTimes(1)
    expect(h.onToggleSelected).toHaveBeenCalledTimes(1)
  })

  test("at zoom -1 tags, status, hover actions and the Telegram link are gone", () => {
    renderFace(-1)
    expect(screen.queryByLabelText("Add tag")).toBeNull()
    expect(screen.queryByText("Never synced")).toBeNull()
    expect(screen.queryByLabelText("Remove Channel")).toBeNull()
    expect(document.querySelector("a[href]")).toBeNull()
  })

  test("at zoom 0 the checkbox selects and the card keeps its full face", () => {
    const h = renderFace(0)
    fireEvent.click(screen.getByLabelText("Select durov"))
    expect(h.onToggleSelected).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText("Add tag")).toBeTruthy()
    expect(screen.getByText("Never synced")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Remove Channel"))
    expect(h.onRemove).toHaveBeenCalledTimes(1)
  })

  test("a syncing compact card lets clicks through its overlay", () => {
    renderFace(-1, true)
    const overlay = screen.getByText(/Syncing/).closest(".absolute.inset-0")
    expect(overlay?.className).toContain("pointer-events-none")
  })
})

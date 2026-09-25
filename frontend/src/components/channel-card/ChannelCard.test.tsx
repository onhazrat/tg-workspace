/**
 * The pieces `ChannelCard` is assembled from. Each takes props only, so no
 * context providers and no `mock.module` (process-wide in bun, see
 * `DataContext.test.tsx`). What is pinned is what the card did before it was
 * split: status precedence, the progress maths, which chips a setting hides,
 * the reserved `group:` prefix, and the Start ID input refusing a non-positive
 * number.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { Channel, ChannelSettingGroup, ChannelStats } from "@/types"
import {
  ChannelCardActions,
  ChannelCardBadges,
  ChannelCardSyncingOverlay,
} from "./ChannelCardChrome"
import { ChannelCardFooter } from "./ChannelCardFooter"
import { ChannelCardHeader } from "./ChannelCardHeader"
import { ChannelCardMeta, type ChannelMetaVisibility } from "./ChannelCardMeta"
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
})

describe("channel-card-status", () => {
  test("restricted beats frozen beats progress", () => {
    const both = { ...base, isUnavailableOnWebView: true, isFrozen: true }
    expect(channelSyncStatus(both, stats(9, 9)).label).toBe("Restricted")
    expect(
      channelSyncStatus({ ...base, isFrozen: true }, stats(9, 9)).label,
    ).toBe("Frozen")
  })

  test("up to date only once the local copy reaches the newest post", () => {
    expect(channelSyncStatus(base, stats(9, 9)).label).toBe("Up to date")
    expect(channelSyncStatus(base, stats(10, 9)).label).toBe("Up to date")
    expect(channelSyncStatus(base, stats(8, 9)).label).toBe("Pending")
    expect(channelSyncStatus(base, stats(8)).label).toBe("Pending")
    expect(channelSyncStatus(base, undefined).label).toBe("Pending")
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
    render(<ChannelCardSyncingOverlay progress={123.4} />)
    expect(screen.getByText("Syncing 123%")).toBeTruthy()
  })

  test("falls back to a plain label with no progress bar", () => {
    const { container } = render(<ChannelCardSyncingOverlay progress={null} />)
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
        stats={{ count: 1234, velocity: 0.4 }}
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
  const renderTags = (onSave = mock()) => {
    render(
      <ChannelCardTags
        tags={["news"]}
        virtualGroupTagName="group:Fast"
        inheritedSettingsHint="hint"
        onSave={onSave}
      />,
    )
    return onSave
  }
  const openInput = () => {
    fireEvent.click(screen.getByText("Add Tag"))
    return screen.getByPlaceholderText("Tag...") as HTMLInputElement
  }

  test("shows the group tag beside the channel's own", () => {
    renderTags()
    expect(screen.getByText("group:Fast").getAttribute("title")).toBe("hint")
    expect(screen.getByText("news")).toBeTruthy()
  })

  test("Enter saves the trimmed tag appended to the list", () => {
    const onSave = renderTags()
    const input = openInput()
    input.value = "  tech "
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0]?.[0] as { name: string }[]
    expect(saved.map((t) => t.name)).toEqual(["news", "tech"])
  })

  test("blank and reserved group: tags are not saved", () => {
    const onSave = renderTags()
    let input = openInput()
    input.value = "   "
    fireEvent.blur(input)
    input = openInput()
    input.value = "group:x"
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText("Tag...")).toBeNull()
  })

  test("Escape closes without saving; the remove button drops one tag", () => {
    const onSave = renderTags()
    fireEvent.keyDown(openInput(), { key: "Escape" })
    expect(screen.queryByPlaceholderText("Tag...")).toBeNull()
    fireEvent.click(screen.getByLabelText("Remove tag news"))
    expect(onSave).toHaveBeenCalledWith([])
  })
})

describe("ChannelCardFooter", () => {
  const renderFooter = (
    channel: Channel,
    overrides: Partial<Parameters<typeof ChannelCardFooter>[0]> = {},
  ) => {
    const props = {
      channel,
      stats: stats(9, 9),
      showStartId: true,
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
    expect(screen.getByText("Up to date")).toBeTruthy()
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
        channel={{ ...base, displayName: "Pavel" }}
        showBio={false}
      />,
    )
    expect(screen.getByTitle("Pavel").textContent).toBe("Pavel")
    expect(screen.getByText("@durov")).toBeTruthy()
    cleanup()
    render(<ChannelCardHeader channel={base} showBio={false} />)
    expect(screen.getByTitle("durov").textContent).toBe("durov")
  })

  test("marks a frozen channel", () => {
    render(<ChannelCardHeader channel={base} showBio={false} />)
    expect(screen.queryByTestId("channel-card-frozen-mark")).toBeNull()
    cleanup()
    render(
      <ChannelCardHeader
        channel={{ ...base, isFrozen: true }}
        showBio={false}
      />,
    )
    expect(screen.getByTestId("channel-card-frozen-mark")).toBeTruthy()
  })

  test("the bio shows only when the setting is on and there is one", () => {
    const withBio = { ...base, bio: "about" }
    render(<ChannelCardHeader channel={withBio} showBio />)
    expect(screen.getByTitle("about").getAttribute("dir")).toBe("auto")
    cleanup()
    render(<ChannelCardHeader channel={withBio} showBio={false} />)
    expect(screen.queryByTitle("about")).toBeNull()
    cleanup()
    render(<ChannelCardHeader channel={base} showBio />)
    expect(screen.queryByText("about")).toBeNull()
  })
})

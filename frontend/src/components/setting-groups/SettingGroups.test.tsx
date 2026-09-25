/**
 * The Channel Setting Groups panel's decisions and pieces. The shell keeps the
 * query, the URL and the three API calls; pinned here is what a group edits
 * into, which groups can be renamed or deleted, and what each control writes.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"

import type { SettingGroupWriteBody } from "@/api"
import type { ChannelSettingGroup } from "@/types"
import {
  type Busy,
  CreateGroupForm,
  GroupEditor,
  GroupList,
} from "./SettingGroupsParts"
import {
  channelCountLabel,
  draftFromGroup,
  emptyDraft,
  groupLabel,
  hasName,
  isDeletable,
  mustEmptyBeforeDelete,
  savedMessage,
} from "./setting-groups-model"

afterEach(cleanup)

const group = (
  extra: Partial<ChannelSettingGroup> = {},
): ChannelSettingGroup => ({
  id: "custom-1",
  name: "News",
  isDefault: false,
  regularSyncEnabled: true,
  dynamicSyncEnabled: false,
  autoSyncIntervalMinutes: 120,
  dynamicSyncExpectedPosts: 5,
  autoFollowForwarded: true,
  isFrozen: false,
  isUnavailableOnWebView: true,
  includeInSyncAll: false,
  includeInBulkSync: true,
  allowIndividualSync: false,
  resetSyncEnabled: true,
  channelCount: 0,
  ...extra,
})

describe("drafts", () => {
  test("a new group starts as a regular, fully permitted one", () => {
    expect(emptyDraft()).toEqual({
      name: "",
      regularSyncEnabled: true,
      dynamicSyncEnabled: false,
      autoSyncIntervalMinutes: 60,
      dynamicSyncExpectedPosts: 15,
      autoFollowForwarded: false,
      isFrozen: false,
      isUnavailableOnWebView: false,
      includeInSyncAll: true,
      includeInBulkSync: true,
      allowIndividualSync: true,
      resetSyncEnabled: true,
    })
    expect(emptyDraft()).not.toBe(emptyDraft())
  })

  test("editing a group copies every writable field and nothing else", () => {
    const g = group({
      channelCount: 4,
      isReserved: false,
      resetSyncEnabled: false,
      isFrozen: true,
    })
    const draft = draftFromGroup(g)
    const { id, isDefault, isReserved, channelCount, ...writable } = g
    expect(draft).toEqual(writable)
  })

  test("a name is required, and whitespace is not one", () => {
    expect(hasName({ name: "x" })).toBe(true)
    expect(hasName({ name: "  " })).toBe(false)
    expect(hasName({})).toBe(false)
  })

  test("the saved toast names the draft, or the group when the draft has none", () => {
    expect(savedMessage({ name: "Renamed" }, group())).toBe(
      'Updated group "Renamed"',
    )
    expect(savedMessage({}, group())).toBe('Updated group "News"')
  })
})

describe("reserved groups", () => {
  test("the default and reserved groups cannot be deleted, a custom one can", () => {
    expect(isDeletable(group())).toBe(true)
    expect(isDeletable(group({ isDefault: true }))).toBe(false)
    expect(isDeletable(group({ isReserved: true }))).toBe(false)
    expect(isDeletable(undefined)).toBe(false)
  })

  test("only a deletable group with channels warns to empty it first", () => {
    expect(mustEmptyBeforeDelete(group({ channelCount: 2 }))).toBe(true)
    expect(mustEmptyBeforeDelete(group({ channelCount: 0 }))).toBe(false)
    expect(mustEmptyBeforeDelete(group({ channelCount: undefined }))).toBe(
      false,
    )
    expect(
      mustEmptyBeforeDelete(group({ channelCount: 2, isDefault: true })),
    ).toBe(false)
  })
})

describe("labels", () => {
  test("the default group says so, and counts are pluralised", () => {
    expect(groupLabel(group())).toBe("News")
    expect(groupLabel(group({ isDefault: true }))).toBe("News (default)")
    expect(channelCountLabel(group({ channelCount: 1 }))).toBe("1 channel")
    expect(channelCountLabel(group({ channelCount: 2 }))).toBe("2 channels")
    expect(channelCountLabel(group({ channelCount: undefined }))).toBe(
      "0 channels",
    )
  })
})

describe("GroupList", () => {
  test("marks the selected group and reports a click with the group", () => {
    const picked: string[] = []
    const groups = [group(), group({ id: "g2", name: "Other" })]
    render(
      <GroupList
        groups={groups}
        selectedId="g2"
        onSelect={(g) => picked.push(g.id)}
      />,
    )
    const [first, second] = screen.getAllByRole("button")
    expect(second.className).toContain("bg-app-ink text-app-bg")
    expect(first.className).not.toContain("bg-app-ink text-app-bg")
    fireEvent.click(first)
    expect(picked).toEqual(["custom-1"])
  })
})

function Editor({
  initial,
  busy = null,
  log,
}: {
  initial: ChannelSettingGroup
  busy?: Busy
  log: { draft?: SettingGroupWriteBody; calls: string[] }
}) {
  const [draft, setDraft] = useState(draftFromGroup(initial))
  log.draft = draft
  return (
    <GroupEditor
      group={initial}
      draft={draft}
      setDraft={setDraft}
      busy={busy}
      onSave={() => log.calls.push("save")}
      onDelete={() => log.calls.push("delete")}
    />
  )
}

describe("GroupEditor", () => {
  test("every control writes its own field", () => {
    const log: { draft?: SettingGroupWriteBody; calls: string[] } = {
      calls: [],
    }
    render(<Editor initial={group()} log={log} />)
    const [name, interval, expected] = [
      screen.getByDisplayValue("News"),
      screen.getByDisplayValue("120"),
      screen.getByDisplayValue("5"),
    ]
    fireEvent.change(name, { target: { value: "World" } })
    fireEvent.change(interval, { target: { value: "30" } })
    fireEvent.change(expected, { target: { value: "9" } })
    fireEvent.click(screen.getByLabelText("Frozen"))
    fireEvent.click(screen.getByLabelText("Auto-follow"))
    fireEvent.click(screen.getByLabelText("Include in Sync All"))
    fireEvent.click(screen.getByLabelText("Reset & Sync enabled"))
    expect(log.draft).toEqual({
      ...draftFromGroup(group()),
      name: "World",
      autoSyncIntervalMinutes: 30,
      dynamicSyncExpectedPosts: 9,
      isFrozen: true,
      autoFollowForwarded: false,
      includeInSyncAll: true,
      resetSyncEnabled: false,
    })
  })

  test("checkboxes show the draft", () => {
    render(<Editor initial={group()} log={{ calls: [] }} />)
    const checked = (label: string) =>
      (screen.getByLabelText(label) as HTMLInputElement).checked
    expect(checked("Regular sync")).toBe(true)
    expect(checked("Dynamic sync")).toBe(false)
    expect(checked("Restricted")).toBe(true)
    expect(checked("Include in bulk sync")).toBe(true)
    expect(checked("Allow individual sync")).toBe(false)
  })

  test("the interval box carries the deployment's bounds", () => {
    render(<Editor initial={group()} log={{ calls: [] }} />)
    const interval = screen.getByDisplayValue("120") as HTMLInputElement
    expect(interval.min).not.toBe("")
    expect(interval.max).not.toBe("")
    expect((screen.getByDisplayValue("5") as HTMLInputElement).min).toBe("1")
  })

  test("a draft missing numbers shows the defaults", () => {
    render(
      <GroupEditor
        group={group()}
        draft={{}}
        setDraft={() => {}}
        busy={null}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.getByDisplayValue("60")).toBeTruthy()
    expect(screen.getByDisplayValue("15")).toBeTruthy()
  })

  test("a custom group can be renamed, saved and deleted", () => {
    const log = { calls: [] as string[] }
    render(<Editor initial={group()} log={log} />)
    expect(
      (screen.getByDisplayValue("News") as HTMLInputElement).disabled,
    ).toBe(false)
    fireEvent.click(screen.getByText("Save group"))
    fireEvent.click(screen.getByText("Delete"))
    expect(log.calls).toEqual(["save", "delete"])
    expect(screen.queryByText(/before\s+deleting this one/)).toBeNull()
  })

  test("a reserved group keeps its name and offers no delete", () => {
    render(
      <Editor
        initial={group({ isDefault: true, channelCount: 3 })}
        log={{ calls: [] }}
      />,
    )
    expect(
      (screen.getByDisplayValue("News") as HTMLInputElement).disabled,
    ).toBe(true)
    expect(screen.queryByText("Delete")).toBeNull()
    expect(screen.queryByText(/before\s+deleting this one/)).toBeNull()
  })

  test("a custom group with channels says to move them first", () => {
    render(<Editor initial={group({ channelCount: 3 })} log={{ calls: [] }} />)
    expect(screen.getByText(/Move all 3 channel\(s\)/)).toBeTruthy()
  })

  test("while busy both buttons are disabled", () => {
    render(<Editor initial={group()} busy="save" log={{ calls: [] }} />)
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })
})

describe("CreateGroupForm", () => {
  test("reports typing and the create click, and disables while busy", () => {
    const calls: string[] = []
    const { rerender } = render(
      <CreateGroupForm
        name={undefined}
        onNameChange={(name) => calls.push(`name ${name}`)}
        busy={null}
        onCreate={() => calls.push("create")}
      />,
    )
    const input = screen.getByPlaceholderText("Group name") as HTMLInputElement
    expect(input.value).toBe("")
    fireEvent.change(input, { target: { value: "Tech" } })
    fireEvent.click(screen.getByText("Create group"))
    expect(calls).toEqual(["name Tech", "create"])
    rerender(
      <CreateGroupForm
        name="Tech"
        onNameChange={() => {}}
        busy="delete"
        onCreate={() => {}}
      />,
    )
    expect(input.value).toBe("Tech")
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})

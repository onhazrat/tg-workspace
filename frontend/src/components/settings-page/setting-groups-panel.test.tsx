/** Setting groups as a table that opens into an editor (SET-03), props only. */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { SettingGroupWriteBody } from "@/api"
import type { ChannelSettingGroup } from "@/types"
import { SettingGroupsView } from "./setting-groups-panel"

afterEach(cleanup)

const group = (over: Partial<ChannelSettingGroup>): ChannelSettingGroup =>
  ({
    id: "g1",
    name: "News",
    isDefault: false,
    isReserved: false,
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
    channelCount: 0,
    ...over,
  }) as ChannelSettingGroup

const props = {
  groups: [
    group({ id: "d", name: "Default", isDefault: true, isReserved: true }),
    group({}),
  ],
  isLoading: false,
  openId: null,
  onOpen: () => {},
  onCreate: async () => {},
  onSave: async () => {},
  onDelete: async () => {},
}

describe("SettingGroupsView", () => {
  test("a row opens its editor", () => {
    const onOpen = mock((_id: string | null) => {})
    render(<SettingGroupsView {...props} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole("button", { name: /^News/ }))
    expect(onOpen).toHaveBeenCalledWith("g1")
  })

  test("the editor saves what was changed", async () => {
    const onSave = mock(
      async (_id: string, _draft: SettingGroupWriteBody) => {},
    )
    render(<SettingGroupsView {...props} openId="g1" onSave={onSave} />)
    fireEvent.change(screen.getByLabelText("Group name"), {
      target: { value: "Daily news" },
    })
    fireEvent.change(screen.getByLabelText("Sync every (minutes)"), {
      target: { value: "90" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Dynamic sync" }))
    fireEvent.click(screen.getByRole("button", { name: "Save group" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const [id, draft] = onSave.mock.calls[0]
    expect(id).toBe("g1")
    expect(draft).toMatchObject({
      name: "Daily news",
      autoSyncIntervalMinutes: 90,
      dynamicSyncEnabled: true,
    })
  })

  test("a reserved group keeps its name and offers no Delete", () => {
    render(<SettingGroupsView {...props} openId="d" />)
    expect(
      (screen.getByLabelText("Group name") as HTMLInputElement).disabled,
    ).toBe(true)
    expect(screen.queryByRole("button", { name: /^Delete group/ })).toBeNull()
  })

  test("a group holding channels says to move them before deleting", () => {
    render(
      <SettingGroupsView
        {...props}
        groups={[group({ channelCount: 3 })]}
        openId="g1"
      />,
    )
    expect(screen.getByText(/Move its 3 channels/)).toBeTruthy()
  })

  test("New group creates one by name", async () => {
    const onCreate = mock(async (_name: string) => {})
    render(<SettingGroupsView {...props} onCreate={onCreate} />)
    fireEvent.click(screen.getByRole("button", { name: "New group" }))
    fireEvent.change(screen.getByLabelText("New group name"), {
      target: { value: "Weekly" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create group" }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Weekly"))
  })
})

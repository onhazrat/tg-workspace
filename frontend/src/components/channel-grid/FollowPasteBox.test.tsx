/**
 * The Follow paste box (CTB-05), props-only: what each pasted handle is marked,
 * what one click follows and into which Setting group, and the progress shown
 * while the job runs.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { FollowJobStatus } from "@/api"
import type { ChannelSettingGroup } from "@/types"
import { FollowPasteBox, type FollowPasteBoxProps } from "./FollowPasteBox"

afterEach(cleanup)

const groups = [
  { id: "g1", name: "Default", isDefault: true },
  { id: "g2", name: "News" },
] as ChannelSettingGroup[]

type Call = { handles: string[]; settingGroupId: string | undefined }

function mount(onFollow?: FollowPasteBoxProps["onFollow"]) {
  const calls: Call[] = []
  render(
    <FollowPasteBox
      followed={["telegram"]}
      settingGroups={groups}
      onFollow={
        onFollow ??
        (async (handles, settingGroupId) => {
          calls.push({ handles, settingGroupId })
          return {} as FollowJobStatus
        })
      }
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Follow" }))
  const paste = (text: string) =>
    fireEvent.change(screen.getByLabelText("Handles to follow"), {
      target: { value: text },
    })
  const followButton = () => screen.getByTestId("follow-paste-submit")
  return { calls, paste, followButton }
}

describe("FollowPasteBox", () => {
  test("keeps the paste when the follow never ran", async () => {
    const { paste, followButton } = mount(async () => null)
    paste("durov")
    await act(async () => fireEvent.click(followButton()))
    expect(
      (screen.getByLabelText("Handles to follow") as HTMLTextAreaElement).value,
    ).toBe("durov")
  })

  test("marks each pasted handle and counts the ones it will follow", () => {
    const { paste, followButton } = mount()
    paste("@durov, t.me/s/Durov\nhttps://t.me/telegram abc")
    const rows = screen
      .getAllByTestId("follow-paste-row")
      .map((row) => row.textContent)
    expect(rows).toEqual([
      "@durov · will follow",
      "@telegram · already following",
      "@abc · not a handle",
    ])
    expect(followButton().textContent).toBe("Follow 1")
    expect(followButton().hasAttribute("disabled")).toBe(false)
  })

  test("is disabled at zero", () => {
    const { paste, followButton } = mount()
    expect(followButton().textContent).toBe("Follow 0")
    expect(followButton().hasAttribute("disabled")).toBe(true)
    paste("telegram abc")
    expect(followButton().hasAttribute("disabled")).toBe(true)
  })

  test("follows only the new handles into the default group unless one is picked", async () => {
    const { calls, paste, followButton } = mount()
    paste("durov telegram bbcpersian")
    expect(
      (screen.getByLabelText("Setting group") as HTMLSelectElement).value,
    ).toBe("g1")
    await act(async () => fireEvent.click(followButton()))
    paste("durov")
    fireEvent.change(screen.getByLabelText("Setting group"), {
      target: { value: "g2" },
    })
    await act(async () => fireEvent.click(followButton()))
    expect(calls).toEqual([
      { handles: ["durov", "bbcpersian"], settingGroupId: "g1" },
      { handles: ["durov"], settingGroupId: "g2" },
    ])
  })

  test("shows progress while the job runs, then clears the paste", async () => {
    let finish = () => {}
    let report: (status: FollowJobStatus) => void = () => {}
    const { paste, followButton } = mount(
      (_handles, _group, onProgress) =>
        new Promise((resolve) => {
          report = onProgress
          finish = () => resolve({} as FollowJobStatus)
        }),
    )
    paste("durov bbcpersian")
    await act(async () => fireEvent.click(followButton()))
    act(() => report({ completed: 1, total: 2 } as FollowJobStatus))
    expect(screen.getByTestId("follow-paste-progress").textContent).toBe(
      "Following… 1 of 2 done",
    )
    expect(followButton().hasAttribute("disabled")).toBe(true)
    await act(async () => finish())
    expect(screen.queryByTestId("follow-paste-progress")).toBeNull()
    expect(
      (screen.getByLabelText("Handles to follow") as HTMLTextAreaElement).value,
    ).toBe("")
  })
})

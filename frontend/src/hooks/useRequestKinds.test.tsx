/** A disabled Request kind greys out what would start it (RKD-02). */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { BulkResync } from "@/components/settings-page/panels"
import { queryKeys } from "@/hooks/queryKeys"
import { queryClient } from "@/lib/queryClient"
import { kindRefusalNow, refusalOf, sinceLabel } from "./useRequestKinds"

afterEach(() => {
  cleanup()
  queryClient.removeQueries({ queryKey: queryKeys.runtimeConfig })
})

const BULK_OFF = "Manual bulk is disabled on this deployment"
const switches = [
  {
    kind: "bulk",
    label: "Manual bulk",
    enabled: false,
    disabledSince: null,
    refusal: BULK_OFF,
  },
  {
    kind: "single",
    label: "Manual single",
    enabled: true,
    disabledSince: null,
    refusal: "Manual single is disabled on this deployment",
  },
]

describe("refusalOf", () => {
  test("a disabled kind's refusal; nothing for an enabled or unknown one", () => {
    expect(refusalOf(switches, "bulk")).toBe(BULK_OFF)
    expect(refusalOf(switches, "single")).toBeNull()
    expect(refusalOf(switches, "other")).toBeNull()
  })

  test("outside React it reads what the cache holds", () => {
    expect(kindRefusalNow("bulk")).toBeNull()
    queryClient.setQueryData(queryKeys.runtimeConfig, {
      requestKinds: switches,
    })
    expect(kindRefusalNow("bulk")).toBe(BULK_OFF)
  })

  test("since reads as a 24-hour clock", () => {
    expect(sinceLabel(Date.parse("2026-10-28T15:04:00"))).toBe("15:04")
  })
})

test("Reset and sync is greyed out with the refusal while bulk is off", async () => {
  const onRun = async () => ({ channelsReset: 0, postsDeleted: 0, errors: [] })
  render(<BulkResync onRun={onRun} />)
  const button = () =>
    screen.getByRole("button", { name: "Reset and sync all channels" })
  expect(button().hasAttribute("disabled")).toBe(false)
  queryClient.setQueryData(queryKeys.runtimeConfig, { requestKinds: switches })
  await waitFor(() => expect(button().hasAttribute("disabled")).toBe(true))
  expect(button().getAttribute("title")).toBe(BULK_OFF)
})

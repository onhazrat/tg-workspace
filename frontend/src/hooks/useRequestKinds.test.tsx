/** A disabled Request kind greys out what would start it (RKD-02). */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { BulkResync } from "@/components/settings-page/panels"
import { PublishPanel } from "@/components/summary-view/PublishPanel"
import { queryKeys } from "@/hooks/queryKeys"
import { queryClient } from "@/lib/queryClient"
import type { BotCredential, ChatDestination } from "@/types"
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

test("Publish is greyed out with the refusal while the Bot API is off", async () => {
  const BOT_OFF = "Bot API is disabled on this deployment"
  queryClient.setQueryData(queryKeys.runtimeConfig, {
    requestKinds: [
      {
        kind: "botApi",
        label: "Bot API",
        enabled: false,
        disabledSince: null,
        refusal: BOT_OFF,
      },
    ],
  })
  const noop = () => {}
  const done = async () => {}
  render(
    <PublishPanel
      bots={[{ id: "b1", name: "Bot" }] as BotCredential[]}
      destinations={
        [{ id: "d1", chatId: "c1", name: "Desk" }] as ChatDestination[]
      }
      plan={{ parts: [], limit: 4096, partial: null } as never}
      options={{ includeMetadata: false, metadataInFirstPart: false }}
      metadataText=""
      onOptionsChange={noop}
      onSaveMetadataText={done}
      onSaveOmittedRows={done}
      publishing={{
        citationStyle: "numbered",
        linkPreviews: false,
        timeZone: "UTC",
      }}
      publishingCustomized={false}
      onPublishingChange={noop}
      onPublishingReset={noop}
      onOpenSettings={noop}
      onPublish={done}
    />,
  )
  const publish = screen.getByRole("button", { name: /^Publish \d/ })
  await waitFor(() => expect(publish.hasAttribute("disabled")).toBe(true))
  expect(publish.getAttribute("title")).toBe(BOT_OFF)
})

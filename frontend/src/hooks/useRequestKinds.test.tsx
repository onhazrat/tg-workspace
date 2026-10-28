/** A disabled Request kind greys out what would start it (RKD-02). */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { RequestKind, RequestKindSwitch } from "@/client"
import { ChannelCardActions } from "@/components/channel-card/ChannelCardChrome"
import { BulkResync } from "@/components/settings-page/panels"
import { PublishPanel } from "@/components/summary-view/PublishPanel"
import { queryKeys } from "@/hooks/queryKeys"
import { buildActionCommands } from "@/lib/commands/actions"
import { buildChannelOpsCommands } from "@/lib/commands/channel-ops"
import { buildExtendedCommands } from "@/lib/commands/extended-commands"
import type { CommandContext } from "@/lib/commands/types"
import { queryClient } from "@/lib/queryClient"
import type { BotCredential, Channel, ChatDestination } from "@/types"
import { kindRefusalNow, refusalOf } from "./useRequestKinds"

afterEach(() => {
  cleanup()
  queryClient.removeQueries({ queryKey: queryKeys.runtimeConfig })
})

const sw = (
  kind: RequestKind,
  label: string,
  enabled: boolean,
): RequestKindSwitch => ({
  kind,
  label,
  settingId: `jobs.deployment.${kind}RequestsEnabled`,
  lanes: [],
  enabled,
  disabledSince: null,
  refusal: `${label} is disabled on this deployment`,
})

const BULK_OFF = "Manual bulk is disabled on this deployment"
const SINGLE_OFF = "Manual single is disabled on this deployment"
const switches = [
  sw("bulk", "Manual bulk", false),
  sw("single", "Manual single", true),
]
const turnOff = (...off: RequestKindSwitch[]) =>
  queryClient.setQueryData(queryKeys.runtimeConfig, { requestKinds: off })

describe("refusalOf", () => {
  test("a disabled kind's refusal; nothing for an enabled or unknown one", () => {
    expect(refusalOf(switches, "bulk")).toBe(BULK_OFF)
    expect(refusalOf(switches, "single")).toBeNull()
    expect(refusalOf(switches, "other")).toBeNull()
  })

  test("outside React it reads what the cache holds", () => {
    expect(kindRefusalNow("bulk")).toBeNull()
    turnOff(...switches)
    expect(kindRefusalNow("bulk")).toBe(BULK_OFF)
  })
})

test("Reset and sync is greyed out with the refusal while bulk is off", async () => {
  const onRun = async () => ({ channelsReset: 0, postsDeleted: 0, errors: [] })
  render(<BulkResync onRun={onRun} />)
  const button = () =>
    screen.getByRole("button", { name: "Reset and sync all channels" })
  expect(button().hasAttribute("disabled")).toBe(false)
  turnOff(...switches)
  await waitFor(() => expect(button().hasAttribute("disabled")).toBe(true))
  expect(button().getAttribute("title")).toBe(BULK_OFF)
})

test("a card's Reset and sync is one Channel's, so single greys it out and bulk does not", async () => {
  render(
    <ChannelCardActions
      channel={{ id: "c1", name: "durov", tags: [], lastUpdated: 0 }}
      busy={false}
      onToggleFreeze={() => {}}
      onResetAndSync={() => {}}
      onRemove={() => {}}
    />,
  )
  turnOff(sw("bulk", "Manual bulk", false))
  const reset = await screen.findByLabelText("Reset & Sync from beginning")
  expect(reset.hasAttribute("disabled")).toBe(false)
  turnOff(sw("single", "Manual single", false))
  const refused = await screen.findByLabelText(SINGLE_OFF)
  expect(refused.hasAttribute("disabled")).toBe(true)
})

test("Publish is greyed out with the refusal while the Bot API is off", async () => {
  const BOT_OFF = "Bot API is disabled on this deployment"
  turnOff(sw("botApi", "Bot API", false))
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

describe("the palette's sync commands", () => {
  const all = [
    ...buildActionCommands(),
    ...buildExtendedCommands(),
    ...buildChannelOpsCommands(),
  ]
  const channels: Channel[] = [
    {
      id: "c1",
      name: "alpha",
      historyCompleteToCutoff: false,
      isUnavailableOnWebView: true,
    },
  ]
  const ctx = {
    isOffline: false,
    channels,
    selectedChannels: new Set(["alpha"]),
  } as unknown as CommandContext
  const gate = (id: string) => {
    const command = all.find((c) => c.id === id)
    if (!command?.disabled) throw new Error(`no gated command ${id}`)
    return command.disabled(ctx)
  }
  const BY_KIND: Record<string, string[]> = {
    bulk: [
      "sync-selected",
      "sync-all",
      "recheck-restricted-channels",
      "bulk-reset-sync-all",
      "fix-all-partial-history",
    ],
    single: [
      "sync-channel",
      "reset-sync-channel",
      "fix-partial-history-channel",
    ],
  }

  test.each(Object.entries(BY_KIND))(
    "with %s off, each of its commands is off with the refusal",
    (kind, ids) => {
      const label = kind === "bulk" ? "Manual bulk" : "Manual single"
      turnOff(sw(kind as RequestKind, label, false))
      for (const id of ids)
        expect([id, gate(id)]).toEqual([
          id,
          { disabled: true, reason: `${label} is disabled on this deployment` },
        ])
    },
  )

  test("with every kind on, the same commands are not refused", () => {
    for (const id of Object.values(BY_KIND).flat())
      expect(`${id}: ${gate(id).reason ?? ""}`).not.toContain("deployment")
  })
})

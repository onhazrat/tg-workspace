import { describe, expect, spyOn, test } from "bun:test"
import { toast } from "sonner"

import { api } from "@/api"
import {
  isNonChannelEntityFlow,
  isSettingGroupEntityFlow,
} from "@/lib/commands/entity-candidates"
import {
  buildGroupCommands,
  formatSettingGroupCandidateLabel,
  getSettingGroupEntityCandidates,
  moveSelectedChannelsToSettingGroup,
} from "@/lib/commands/group-commands"
import type { CommandContext } from "@/lib/commands/types"
import type { Channel, ChannelSettingGroup } from "@/types"

const sampleGroups: ChannelSettingGroup[] = [
  {
    id: "default-global",
    name: "default",
    isDefault: true,
    regularSyncEnabled: true,
    dynamicSyncEnabled: false,
    autoSyncIntervalMinutes: 60,
    dynamicSyncExpectedPosts: 15,
    autoFollowForwarded: false,
    isFrozen: false,
    isUnavailableOnWebView: false,
    channelCount: 2,
  },
  {
    id: "slow-feed-global",
    name: "Slow feed",
    isDefault: false,
    regularSyncEnabled: true,
    dynamicSyncEnabled: true,
    autoSyncIntervalMinutes: 1440,
    dynamicSyncExpectedPosts: 1,
    autoFollowForwarded: false,
    isFrozen: false,
    isUnavailableOnWebView: false,
    channelCount: 0,
  },
  {
    id: "custom-1",
    name: "News",
    isDefault: false,
    regularSyncEnabled: true,
    dynamicSyncEnabled: false,
    autoSyncIntervalMinutes: 120,
    dynamicSyncExpectedPosts: 5,
    autoFollowForwarded: false,
    isFrozen: false,
    isUnavailableOnWebView: false,
  },
]

const sampleChannels: Channel[] = [
  { id: "c1", name: "alpha", settingGroupId: "default-global" },
  { id: "c2", name: "beta", settingGroupId: "custom-1" },
]

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    channels: sampleChannels,
    selectedChannels: new Set(["alpha"]),
    settingGroups: sampleGroups,
    setActiveTab: () => {},
    setActiveSection: () => {},
    setChannelGroupFilter: () => {},
    setSelectedSettingGroup: () => {},
    setSelectedChannels: () => {},
    setChannels: () => {},
    invalidateSettingGroups: async () => {},
    isOffline: false,
    ...overrides,
  } as CommandContext
}

describe("buildGroupCommands", () => {
  const commands = buildGroupCommands()

  test("registers all three group palette commands", () => {
    expect(commands.map((command) => command.id)).toEqual([
      "filter-channels-by-setting-group",
      "move-selected-channels-to-setting-group",
      "open-setting-group",
    ])
  })

  test("commands use entity-root kind with setting group flows", () => {
    expect(
      commands.every(
        (command) =>
          command.kind === "entity-root" &&
          command.entityFlow?.endsWith("setting-group"),
      ),
    ).toBe(true)
  })

  test("move command disabled without channel selection", () => {
    const move = commands.find(
      (command) => command.id === "move-selected-channels-to-setting-group",
    )
    expect(
      move?.disabled?.(makeContext({ selectedChannels: new Set() })),
    ).toEqual({
      disabled: true,
      reason: "No channels selected",
    })
  })

  test("filter command navigates to channels tab and applies group filter", () => {
    let activeTab: string | null = null
    let filterId: string | null = null
    const filter = commands.find(
      (command) => command.id === "filter-channels-by-setting-group",
    )
    filter?.run(
      makeContext({
        setActiveTab: (tab) => {
          activeTab = tab
        },
        setChannelGroupFilter: (groupId) => {
          filterId = groupId
        },
      }),
      "slow-feed-global",
    )
    expect(activeTab).toBe("channels")
    expect(filterId).toBe("slow-feed-global")
  })

  test("open command navigates to sync settings and selects group", () => {
    let activeTab: string | null = null
    let section: string | null = null
    let groupId: string | null = null
    const open = commands.find((command) => command.id === "open-setting-group")
    open?.run(
      makeContext({
        setActiveTab: (tab) => {
          activeTab = tab
        },
        setActiveSection: (next) => {
          section = next
        },
        setSelectedSettingGroup: (id) => {
          groupId = id
        },
      }),
      "custom-1",
    )
    expect(activeTab).toBe("settings")
    expect(section).toBe("channels-sync")
    expect(groupId).toBe("custom-1")
  })
})

describe("setting group entity candidates", () => {
  test("includes zero-channel builtin groups", () => {
    const candidates = getSettingGroupEntityCandidates(makeContext(), "")
    expect(candidates.map((item) => item.id)).toEqual([
      "default-global",
      "slow-feed-global",
      "custom-1",
    ])
    expect(candidates[1]?.label).toBe("Slow feed (0 channels)")
  })

  test("filters candidates by query", () => {
    const candidates = getSettingGroupEntityCandidates(makeContext(), "slow")
    expect(candidates).toEqual([
      { id: "slow-feed-global", label: "Slow feed (0 channels)" },
    ])
  })

  test("formatSettingGroupCandidateLabel falls back to channel membership", () => {
    expect(
      formatSettingGroupCandidateLabel(sampleGroups[2]!, sampleChannels),
    ).toBe("News (1 channel)")
  })
})

describe("moveSelectedChannelsToSettingGroup", () => {
  /**
   * Run a move with `api.bulkAssignSettingGroup` and `toast.success` stubbed,
   * and hand back what reached the server, the updated channel list, how many
   * times the groups were invalidated and what was toasted.
   */
  async function move(groupId: string, selected: string[]) {
    const original = api.bulkAssignSettingGroup
    const toastSpy = spyOn(toast, "success")
    const sent: unknown[] = []
    let channels = sampleChannels
    let invalidated = 0
    api.bulkAssignSettingGroup = (async (body: unknown) => {
      sent.push(body)
    }) as never
    try {
      await moveSelectedChannelsToSettingGroup(
        makeContext({
          selectedChannels: new Set(selected),
          setChannels: ((update: (prev: Channel[]) => Channel[]) => {
            channels = update(channels)
          }) as CommandContext["setChannels"],
          invalidateSettingGroups: async () => {
            invalidated++
          },
        }),
        groupId,
      )
      return {
        sent,
        channels,
        invalidated,
        toasts: toastSpy.mock.calls.map((c) => c[0]),
      }
    } finally {
      api.bulkAssignSettingGroup = original
      toastSpy.mockRestore()
    }
  }

  test("assigns only the selected channels and copies the group's policy onto them", async () => {
    const { sent, channels, invalidated, toasts } = await move(
      "slow-feed-global",
      ["alpha"],
    )
    expect(sent).toEqual([
      { channelIds: ["c1"], settingGroupId: "slow-feed-global" },
    ])
    expect(channels[0]).toMatchObject({
      settingGroupId: "slow-feed-global",
      settingGroupName: "Slow feed",
      dynamicSyncEnabled: true,
      autoSyncIntervalMinutes: 1440,
    })
    expect(channels[1]).toBe(sampleChannels[1])
    expect(invalidated).toBe(1)
    expect(toasts).toEqual(['Moved 1 channel to "Slow feed"'])
  })

  test("pluralises the toast for several channels", async () => {
    const { toasts } = await move("custom-1", ["alpha", "beta"])
    expect(toasts).toEqual(['Moved 2 channels to "News"'])
  })

  test("does nothing for an unknown group or a selection with no channels", async () => {
    for (const [groupId, selected] of [
      ["missing", ["alpha"]],
      ["custom-1", ["not-a-channel"]],
    ] as const) {
      const result = await move(groupId, [...selected])
      expect(result).toEqual({
        sent: [],
        channels: sampleChannels,
        invalidated: 0,
        toasts: [],
      })
    }
  })
})

describe("setting group entity flow helpers", () => {
  test("isSettingGroupEntityFlow recognizes group flows", () => {
    expect(isSettingGroupEntityFlow("filter-by-setting-group")).toBe(true)
    expect(isSettingGroupEntityFlow("search-channel")).toBe(false)
  })

  test("isNonChannelEntityFlow includes setting group flows", () => {
    expect(isNonChannelEntityFlow("open-setting-group")).toBe(true)
  })
})

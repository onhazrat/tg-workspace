/**
 * A Complete Channel's verdict and a check of some, typed from the generated
 * client, for the unit tests and the Playwright mocks alike: each test says
 * only what makes its Channel Incomplete.
 */

import type { ChannelVerdict, WindowCheckResponse } from "@/client"

export function verdict(
  name: string,
  over: Partial<ChannelVerdict> = {},
): ChannelVerdict {
  return {
    name,
    reasons: [],
    reason: null,
    lastSync: null,
    headReadAt: null,
    error: null,
    stretches: [],
    missingIds: 0,
    syncable: true,
    behind: false,
    pacePerHour: 1,
    heldPosts: 10,
    unprovenPosts: 0,
    syncingSince: null,
    syncAgain: false,
    ...over,
  }
}

export function windowCheck(
  channels: ChannelVerdict[],
  over: Partial<WindowCheckResponse> = {},
): WindowCheckResponse {
  const end = over.end ?? Date.now()
  return {
    frozenAt: end,
    start: end - 3_600_000,
    end,
    channels,
    heldPosts: channels.reduce((n, c) => n + c.heldPosts, 0),
    unprovenPosts: Math.round(
      channels.reduce((n, c) => n + (c.reason ? c.unprovenPosts : 0), 0),
    ),
    unprovenFloor: false,
    ...over,
  }
}

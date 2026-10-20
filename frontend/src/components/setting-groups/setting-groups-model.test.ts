/**
 * What a Setting group edits into, and which groups can be deleted. The table
 * and editor that use these are pinned in the Settings page's own tests.
 */
import { describe, expect, test } from "bun:test"
import type { ChannelSettingGroup } from "@/types"
import {
  draftFromGroup,
  emptyDraft,
  isDeletable,
  mustEmptyBeforeDelete,
} from "./setting-groups-model"

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

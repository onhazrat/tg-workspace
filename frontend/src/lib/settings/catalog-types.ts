import type { CommandSettingsSlice } from "@/lib/commands/types"

/** TOC / feature groups used by the Settings hub and `@feature:` search. */
export type SettingsFeatureGroup =
  | "appearance"
  | "channels-sync"
  | "ai"
  | "network"
  | "publishing"
  | "data"
  | "tools"
  | "jobs"

export type SettingSource = "app" | "network" | "theme" | "jobs"

export type SettingControlKind =
  | "boolean"
  | "number"
  | "enum"
  | "textarea"
  | "days"
  | "panel"

export interface SettingEnumOption {
  value: string
  label: string
}

export interface SettingNumberControl {
  kind: "number"
  min?: number
  max?: number
  step?: number | "any"
  integer?: boolean
  formatBadge?: (value: number) => string
}

export interface SettingEnumControl {
  kind: "enum"
  options: SettingEnumOption[]
  /** Prefix for `set-{prefix}-{slug}` command ids. */
  commandPrefix: string
}

export interface SettingBooleanControl {
  kind: "boolean"
  /** Slug for toggle/enable/disable-{slug} command ids. */
  commandSlug: string
}

export interface SettingTextareaControl {
  kind: "textarea"
  commandId: string
  fieldId: string
}

export interface SettingDaysControl {
  kind: "days"
  commandId: string
  fieldId: string
}

export interface SettingPanelControl {
  kind: "panel"
  /** TOC section id to navigate to. */
  sectionId: string
}

export type SettingControl =
  | SettingBooleanControl
  | SettingNumberControl
  | SettingEnumControl
  | SettingTextareaControl
  | SettingDaysControl
  | SettingPanelControl

export interface SettingCatalogEntry {
  id: string
  label: string
  description: string
  keywords: string[]
  group: SettingsFeatureGroup
  source: SettingSource
  control: SettingControl
  defaultValue: unknown
  /**
   * For number editors: explicit command id (e.g. `edit-post-retention-days`).
   * Required when control.kind === "number" and the setting is palette-editable.
   */
  editorCommandId?: string
  editorFieldId?: string
  editorFieldLabel?: string
  /** Hide from flatten search results (rare). */
  searchHidden?: boolean
  /** Custom getter/setter keys on CommandSettingsSlice when id ≠ slice key. */
  sliceKey?: keyof CommandSettingsSlice
}

export interface SettingsSearchHit {
  entry: SettingCatalogEntry
  score: number
}

export interface ParsedSettingsQuery {
  /** Free-text tokens after operators are stripped. */
  text: string
  /** `@modified` — only rows whose value ≠ default. */
  modifiedOnly: boolean
  /** `@feature:<group>` */
  feature?: SettingsFeatureGroup
  /** `@id:<catalogId>` */
  id?: string
}

export interface SettingsSearchProvider {
  search: (
    query: string,
    options?: {
      entries?: SettingCatalogEntry[]
      isModified?: (entry: SettingCatalogEntry) => boolean
    },
  ) => SettingsSearchHit[]
}

/**
 * The Settings registry for this Account, browser rows filled in (SET-02).
 *
 * The backend declares every Setting, browser ones included. A browser row
 * arrives without a value, because only this browser knows it: the value
 * comes from `SettingsContext` (or the theme provider) and the default from
 * the frontend schema, which `test_setting_declarations.py` holds equal to
 * the declarations. A frontend build value (SET-04) arrives without one for
 * the same reason: only this bundle knows what it was built with.
 *
 * A server write goes through `PUT /settings/{settingId}` and its answer
 * replaces the row. `SettingsContext`, which keeps whole sections for the
 * rest of the app, then re-reads the row's section, so every tab sees the
 * change without a reload and nothing writes it a second time.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"
import {
  type SettingsRegistryResponse,
  settingsReadSettingsRegistry,
  settingsUpdateSetting,
} from "@/client"
import { APP_DEFAULT_THEME, type Theme } from "@/components/theme-provider"
import { useSettings } from "@/contexts/SettingsContext"
import { queryKeys } from "@/hooks/queryKeys"
import { frontendBuildValue, hasFrontendBuildValue } from "@/lib/env"
import { appSettingsSpec } from "@/lib/settings/schema"
import { setterName } from "@/lib/settings/store"
import { THEME_STORAGE_KEY } from "@/lib/storage/scoped"
import type { Row } from "./model"

type SpecMap = Record<string, { defaultValue: unknown } | undefined>
const SPECS = appSettingsSpec as unknown as SpecMap

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A choice's string back to the type the browser stores (card zoom is a number). */
function browserValue(key: string, value: unknown): unknown {
  const def = SPECS[key]?.defaultValue
  return typeof def === "number" && typeof value === "string"
    ? Number(value)
    : value
}

/**
 * What this bundle runs for a build value: the built one, or the fallback the
 * code uses without one. Built differently from that fallback counts as
 * changed; a secret is only "set" or "not set", and never changed.
 */
function withBuildValue(row: Row): Row {
  const name = row.envName ?? ""
  const built = hasFrontendBuildValue(name)
  if (row.sensitive)
    return { ...row, value: built ? "set" : "not set", modified: false }
  const value = frontendBuildValue(name, row.default)
  return {
    ...row,
    value: value as Row["value"],
    modified: built && String(value) !== String(row.default),
  }
}

export function useSettingsRegistry({ enabled = true } = {}) {
  const settings = useSettings()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.settingsRegistry,
    queryFn: () => settingsReadSettingsRegistry(),
    staleTime: 30_000,
    retry: false,
    enabled,
  })

  const values = settings as unknown as Record<string, unknown>

  /** Hands a browser value to `SettingsContext`'s setter for its key. */
  const setBrowserValue = useCallback(
    (key: string, value: unknown) => {
      const setter = values[setterName(key)]
      if (typeof setter === "function") setter(value)
    },
    [values],
  )

  const rows = useMemo<Row[]>(
    () =>
      (query.data?.rows ?? []).map((row) => {
        if (row.applies === "rebuild") return withBuildValue(row)
        if (row.scope !== "browser") return row
        const key = row.key ?? ""
        if (key === THEME_STORAGE_KEY) {
          return {
            ...row,
            value: settings.theme,
            default: APP_DEFAULT_THEME,
            modified: settings.theme !== APP_DEFAULT_THEME,
          }
        }
        const value = values[key]
        const def = SPECS[key]?.defaultValue
        return { ...row, value, default: def, modified: !same(value, def) }
      }),
    [query.data, settings.theme, values],
  )

  const replaceRow = useCallback(
    (updated: Row) =>
      client.setQueryData<SettingsRegistryResponse>(
        queryKeys.settingsRegistry,
        (old) =>
          old && {
            ...old,
            rows: old.rows.map((r) => (r.id === updated.id ? updated : r)),
          },
      ),
    [client],
  )

  const write = useCallback(
    async (row: Row, body: { value?: unknown; reset?: boolean }) => {
      if (row.scope === "browser") {
        const key = row.key ?? ""
        const next = body.reset ? row.default : body.value
        if (key === THEME_STORAGE_KEY) settings.setTheme(next as Theme)
        else setBrowserValue(key, browserValue(key, next))
        return
      }
      const updated = await settingsUpdateSetting({
        path: { setting_id: row.id },
        body,
      })
      replaceRow(updated)
      // The rest of the app reads whole sections: re-read this one rather
      // than echo the value into a setter, which would write it again.
      if (updated.key) settings.refreshSection(updated.key).catch(console.error)
    },
    [setBrowserValue, replaceRow, settings],
  )

  return {
    rows,
    topics: query.data?.topics ?? [],
    permissions: query.data?.permissions ?? [],
    isLoading: query.isLoading,
    error: query.error,
    save: (row: Row, value: unknown) => write(row, { value }),
    reset: (row: Row) => write(row, { reset: true }),
  }
}

export type SettingsRegistry = ReturnType<typeof useSettingsRegistry>

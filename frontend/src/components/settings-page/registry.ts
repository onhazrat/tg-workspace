/**
 * The Settings registry for this Account, browser rows filled in (SET-02).
 *
 * The backend declares every Setting, browser ones included. A browser row
 * arrives without a value, because only this browser knows it: the value
 * comes from `SettingsContext` (or the theme provider) and the default from
 * the frontend schema, which `test_setting_declarations.py` holds equal to
 * the declarations.
 *
 * A server write goes through `PUT /settings/{settingId}` and its answer
 * replaces the row. The same value is then handed to `SettingsContext`, which
 * keeps whole sections for the rest of the app, so every tab sees the change
 * without a reload.
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
import { appSettingsSpec } from "@/lib/settings/schema"
import { THEME_STORAGE_KEY } from "@/lib/storage/scoped"
import type { Row } from "./model"

const BROWSER_PREFIX = "This browser: "

/** The storage key a browser row is kept under. */
export const browserKey = (row: Row) => row.storage.slice(BROWSER_PREFIX.length)

/** The field of its settings key a server row is stored in. */
const serverField = (row: Row) => row.storage.split(".").at(-1) ?? ""

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

function setterName(field: string) {
  return `set${field.charAt(0).toUpperCase()}${field.slice(1)}`
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

  /** Hands a value to `SettingsContext`'s setter for that field, if it has one. */
  const applyLocally = useCallback(
    (field: string, value: unknown) => {
      const setter = values[setterName(field)]
      if (typeof setter === "function") setter(value)
    },
    [values],
  )

  const rows = useMemo<Row[]>(
    () =>
      (query.data?.rows ?? []).map((row) => {
        if (row.scope !== "browser") return row
        const key = browserKey(row)
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
        const key = browserKey(row)
        const next = body.reset ? row.default : body.value
        if (key === THEME_STORAGE_KEY) settings.setTheme(next as Theme)
        else applyLocally(key, browserValue(key, next))
        return
      }
      const updated = await settingsUpdateSetting({
        path: { setting_id: row.id },
        body,
      })
      replaceRow(updated)
      applyLocally(serverField(updated), updated.value)
    },
    [applyLocally, replaceRow, settings],
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

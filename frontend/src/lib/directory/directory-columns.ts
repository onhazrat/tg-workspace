/**
 * The Directory's columns (DCOL). The deployment decides which are on by
 * default; an Account sets any of them On or Off in this browser, and a column
 * it never touched follows the default as the default changes. A list read
 * carries only the columns it asks for, so this is also where "does showing
 * this column need a new read?" is answered.
 */
import type { DirectoryColumnResponse } from "@/client"

export type ColumnKey = DirectoryColumnResponse["key"]
/** The columns this caller may show, in table order, with their defaults. */
export type ColumnCatalogue = DirectoryColumnResponse[]
/** An Account's explicit choices; a column with none is at its default. */
export type ColumnChoices = Partial<Record<ColumnKey, "on" | "off">>

/**
 * Every column key, keyed by the generated union so a key the server adds or
 * drops is a compile error here.
 */
const KEYS: Record<ColumnKey, true> = {
  language: true,
  subscribers: true,
  reach: true,
  posts_per_week: true,
  forward_pct: true,
  last_post_at: true,
  mine: true,
  cited_by: true,
  cites: true,
  created_at: true,
  photos: true,
  videos: true,
  files: true,
  links: true,
  status: true,
  followable: true,
  kind: true,
  bio: true,
  sample_count: true,
  checked_at: true,
  refresh_due_at: true,
  attempts: true,
  last_error: true,
  attempted_at: true,
  retry_after: true,
  priority: true,
  priority_boost: true,
  effective_priority: true,
  telegram_chat_id: true,
  latest_id: true,
}
export const isColumnKey = (key: string): key is ColumnKey => key in KEYS

/**
 * The columns only a `DATA_ADMIN` reader may see, sort or filter by: the
 * server's `INTERNAL_COLUMNS`, which answers anybody else's sort or Condition
 * on one with a 422 (DPF). Every internal gate in the browser reads this set,
 * and none names a key of its own. `test_directory_every_column.py` parses
 * this block and holds it equal to the server's, in both directions.
 */
export const INTERNAL_COLUMNS: ReadonlySet<ColumnKey> = new Set<ColumnKey>([
  "kind",
  "attempts",
  "last_error",
  "attempted_at",
  "retry_after",
  "priority",
  "priority_boost",
  "effective_priority",
  "telegram_chat_id",
  "latest_id",
])
export const isInternal = (key: string): boolean =>
  (INTERNAL_COLUMNS as ReadonlySet<string>).has(key)

export const isOn = (
  column: DirectoryColumnResponse,
  choices: ColumnChoices,
): boolean => {
  const choice = choices[column.key]
  return choice === undefined ? column.default : choice === "on"
}

/** The columns the table shows, in table order. */
export const shownColumns = (
  catalogue: ColumnCatalogue,
  choices: ColumnChoices,
): ColumnKey[] => catalogue.filter((c) => isOn(c, choices)).map((c) => c.key)

/** One column set On or Off, or back to Default with `undefined`. */
export function setChoice(
  choices: ColumnChoices,
  key: ColumnKey,
  choice: "on" | "off" | undefined,
): ColumnChoices {
  const { [key]: _, ...rest } = choices
  return choice === undefined ? rest : { ...rest, [key]: choice }
}

/** The choices the catalogue lists: what "N set" counts and Reset clears. */
export const choiceCount = (
  catalogue: ColumnCatalogue,
  choices: ColumnChoices,
): number => catalogue.filter((c) => choices[c.key] !== undefined).length

/**
 * Whether this caller may set the deployment's defaults. The server lists the
 * probe queue's columns only to `DATA_ADMIN`, the Permission the `PUT` needs,
 * so the catalogue already is the reading of it.
 */
// ponytail: one Permission read through the catalogue. If the PUT ever moves
// to its own Permission, publish it on the catalogue response instead.
export const mayMakeDefaults = (catalogue: ColumnCatalogue): boolean =>
  catalogue.some((c) => INTERNAL_COLUMNS.has(c.key))

/**
 * Whether this caller holds `DATA_ADMIN`, read the same way: the internal
 * sorts and Conditions, every kind of entry and the Priority boost are its
 * (DPF).
 */
export const seesInternals = mayMakeDefaults

/** The hidden list stored before DCOL, as explicit Offs. */
export const choicesFromHidden = (hidden: string[]): ColumnChoices =>
  Object.fromEntries(
    hidden.filter(isColumnKey).map((key) => [key, "off"]),
  ) as ColumnChoices

/**
 * What a list read asks for. The last request stands while it carries every
 * shown column, so hiding one reads nothing; showing one it lacks asks for
 * exactly the shown ones, sorted so the query key is stable.
 */
export function columnsToSend(
  shown: ColumnKey[],
  previous: ColumnKey[] | undefined,
): ColumnKey[] {
  if (previous && shown.every((key) => previous.includes(key))) return previous
  return [...shown].sort()
}

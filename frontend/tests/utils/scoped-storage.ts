import type { Page } from "@playwright/test"

import {
  decodeJwtSubject,
  scopedKey,
  TOKEN_STORAGE_KEY,
} from "../../src/lib/storage/scoped"

/**
 * Seed and read the app's browser storage the way the app writes it.
 *
 * Ticket 02 moved every non-device key under `u:<userId>:`. A spec that seeds
 * `hasSeenTour` under its bare name is not merely ineffective — it fails in the
 * most expensive way available: the guided tour opens over the UI and every
 * later assertion in the file misses its target for reasons that have nothing
 * to do with what the spec is testing.
 *
 * The prefix is computed **here**, in Node, by calling the app's own `scopedKey`
 * with the subject decoded from the token the page is holding. That is the point
 * of the round trip — a helper that rebuilt `u:<id>:` by hand would be a second
 * declaration of the namespace format, and the first thing to drift the day the
 * format changes.
 */
async function keysFor(page: Page, keys: string[]): Promise<string[]> {
  const token = await page.evaluate(
    (tokenKey) => localStorage.getItem(tokenKey),
    TOKEN_STORAGE_KEY,
  )
  const userId = token === null ? null : decodeJwtSubject(token)
  return keys.map((key) => scopedKey(key, userId))
}

/** Write entries under the signed-in account's namespace. */
export async function seedScopedStorage(
  page: Page,
  entries: Record<string, string>,
): Promise<void> {
  const names = Object.keys(entries)
  const scoped = await keysFor(page, names)
  const pairs = names.map((name, i) => [scoped[i], entries[name]] as const)

  await page.evaluate((pairs) => {
    for (const [key, value] of pairs) localStorage.setItem(key, value)
  }, pairs)
}

/** Read one value back from the signed-in account's namespace. */
export async function readScopedStorage(
  page: Page,
  key: string,
): Promise<string | null> {
  const [scoped] = await keysFor(page, [key])
  return page.evaluate((k) => localStorage.getItem(k), scoped)
}

/** Remove entries from the signed-in account's namespace. */
export async function clearScopedStorage(
  page: Page,
  keys: string[],
): Promise<void> {
  const scoped = await keysFor(page, keys)
  await page.evaluate((names) => {
    for (const key of names) localStorage.removeItem(key)
  }, scoped)
}

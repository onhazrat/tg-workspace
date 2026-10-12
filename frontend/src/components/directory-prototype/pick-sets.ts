/**
 * PROTOTYPE (directory-follow-picks, variant F): named pick sets, a saved
 * list of handles a Shared or Cited filter can compare with, live. Any
 * Channel can be in one, followed or not.
 *
 * ponytail: kept per browser and Account in the scoped storage; folding in
 * needs a per-Account table so a set follows the Account across devices.
 */
import { useSyncExternalStore } from "react"
import { scopedStorage } from "@/lib/storage/scoped"

const KEY = "directory.pickSets"

export type PickSet = { name: string; handles: string[] }

function read(): PickSet[] {
  try {
    const value: unknown = JSON.parse(scopedStorage.getItem(KEY) ?? "[]")
    return Array.isArray(value) ? (value as PickSet[]) : []
  } catch {
    return []
  }
}

// Read on first use, so the storage is the signed-in Account's rather than
// whoever the module loaded under. ponytail: not re-read on an Account
// switch without a reload; the per-Account table fixes that for free.
let current: PickSet[] | null = null
const snapshot = () => {
  current ??= read()
  return current
}
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function write(next: PickSet[]) {
  current = next
  scopedStorage.setItem(KEY, JSON.stringify(next))
  for (const l of listeners) l()
}

/** A set name as the filter's text form can carry it: no spaces. */
export const setName = (text: string) =>
  text.trim().replace(/\s+/g, "-").slice(0, 40)

const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort()

export const pickSets = {
  save(name: string, handles: string[]) {
    const n = setName(name)
    if (!n) return
    const others = snapshot().filter((s) => s.name !== n)
    write([...others, { name: n, handles: merge([], handles) }])
  },
  add(name: string, handles: string[]) {
    write(
      snapshot().map((s) =>
        s.name === name ? { ...s, handles: merge(s.handles, handles) } : s,
      ),
    )
  },
  remove(name: string, handles: string[]) {
    write(
      snapshot().map((s) =>
        s.name === name
          ? { ...s, handles: s.handles.filter((h) => !handles.includes(h)) }
          : s,
      ),
    )
  },
  drop(name: string) {
    write(snapshot().filter((s) => s.name !== name))
  },
}

export function usePickSets(): PickSet[] {
  return useSyncExternalStore(subscribe, snapshot)
}

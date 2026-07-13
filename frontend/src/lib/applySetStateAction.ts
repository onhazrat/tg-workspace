import type { SetStateAction } from "react"

/**
 * Apply a React `SetStateAction` (plain value or updater function) to a
 * previous value, mirroring `useState` setter semantics. Used to implement
 * query-cache write-throughs that stay `React.Dispatch`-compatible.
 */
export function applySetStateAction<T>(action: SetStateAction<T>, prev: T): T {
  return typeof action === "function"
    ? (action as (previous: T) => T)(prev)
    : action
}

import { useState } from "react"
import { scopedSessionStorage } from "@/lib/storage/scoped"

/**
 * A switch that lasts for the browser session, per Account. Not in the
 * settings schema, which persists to local storage and the server: these
 * switches reset with a new session. Both states are stored, so a switch that
 * defaults on remembers being turned off.
 */
export function useSessionFlag(
  key: string,
  defaultOn = false,
): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    const stored = scopedSessionStorage.getItem(key)
    return stored === null ? defaultOn : stored === "1"
  })
  const set = (next: boolean) => {
    setOn(next)
    scopedSessionStorage.setItem(key, next ? "1" : "0")
  }
  return [on, set]
}

/** The Posts tab's Compact grid: on at the start of every session (CARD-01). */
export const useCompactPostGrid = () =>
  useSessionFlag("postFeed_compactGrid", true)

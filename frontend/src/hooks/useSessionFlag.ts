import { useState } from "react"
import { scopedSessionStorage } from "@/lib/storage/scoped"

/**
 * A switch that lasts for the browser session, per Account. Not in the
 * settings schema, which persists to local storage and the server: the Compact
 * grid and Keyboard switches must reset with a new session (spec story 32).
 */
export function useSessionFlag(key: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => scopedSessionStorage.getItem(key) === "1")
  const set = (next: boolean) => {
    setOn(next)
    if (next) scopedSessionStorage.setItem(key, "1")
    else scopedSessionStorage.removeItem(key)
  }
  return [on, set]
}

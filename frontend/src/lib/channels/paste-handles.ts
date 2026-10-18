import { normalizeChannelHandle } from "./add-channel"

export type PastedHandle = {
  handle: string
  status: "new" | "known" | "invalid"
}

// ponytail: the server's shape rule (`is_channel_handle`) without its reserved
// paths, which come back in the server's own count; the fetch still asks Telegram.
const HANDLE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/

/**
 * Every handle in a paste for a handle box (CTB-05, DADD): `@handle`,
 * `t.me/handle` and `t.me/s/handle`, split on lines, spaces and commas, first
 * spelling kept when one repeats, each marked against the handles the caller
 * already knows (the Channels followed, for the Follow box).
 */
export function parsePastedHandles(
  text: string,
  known: Iterable<string>,
): PastedHandle[] {
  const knownKeys = new Set([...known].map((name) => name.toLowerCase()))
  const seen = new Set<string>()
  const out: PastedHandle[] = []
  for (const raw of text.split(/[\s,]+/)) {
    const handle = normalizeChannelHandle(raw)
    const key = handle.toLowerCase()
    if (!handle || seen.has(key)) continue
    seen.add(key)
    out.push({
      handle,
      status: !HANDLE.test(handle)
        ? "invalid"
        : knownKeys.has(key)
          ? "known"
          : "new",
    })
  }
  return out
}

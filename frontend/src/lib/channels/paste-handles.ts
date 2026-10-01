import { normalizeChannelHandle } from "./add-channel"

export type PastedHandle = {
  handle: string
  status: "new" | "following" | "invalid"
}

// ponytail: the shape of a public username, not a lookup; the follow still asks Telegram.
const HANDLE = /^[A-Za-z0-9_]{4,32}$/

/**
 * Every handle in a paste for the Follow box (CTB-05): `@handle`, `t.me/handle`
 * and `t.me/s/handle`, split on lines, spaces and commas, first spelling kept
 * when one repeats, each marked against the Channels already followed.
 */
export function parsePastedHandles(
  text: string,
  followed: Iterable<string>,
): PastedHandle[] {
  const following = new Set([...followed].map((name) => name.toLowerCase()))
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
        : following.has(key)
          ? "following"
          : "new",
    })
  }
  return out
}

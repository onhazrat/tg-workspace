import { queryClient } from "@/lib/queryClient"
import { TOKEN_STORAGE_KEY } from "@/lib/storage/scoped"

export const API_BASE = import.meta.env.VITE_API_URL || ""
const API_KEY = import.meta.env.VITE_API_KEY || ""

/**
 * A failed HTTP response from either client, carrying the status.
 *
 * Both API clients throw this (ADR-006 keeps them separate; it does not require
 * them to fail differently). `message` is the FastAPI `detail` string, which is
 * what `lib/api-errors.ts` parses and what every existing `err instanceof Error`
 * branch reads — so this is a strict widening of what was thrown before, not a
 * new contract.
 *
 * **The `status` is the point.** Before F1b only the generated client's errors
 * carried one, and `main.tsx` defaulted everything else to `401` — which meant
 * any failing summarizer query logged the operator out. Auth failures are now
 * handled once, at the transport, by both clients.
 */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, detail: string, body?: unknown) {
    super(detail)
    this.name = "ApiError"
    this.status = status
    this.body = body
  }
}

export function headers(json = true): HeadersInit {
  const h: Record<string, string> = {}
  if (json) h["Content-Type"] = "application/json"
  if (API_KEY) h["X-API-Key"] = API_KEY
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

/**
 * The detail `get_current_user` gives an account an Admin has switched off.
 * A 403 that genuinely means the session is finished, as opposed to the many
 * that mean "not this route".
 */
export const INACTIVE_USER_DETAIL = "Inactive user"

/**
 * Whether the server is saying this *session* is over, rather than refusing
 * one request.
 *
 * **A bare 403 is not that, and treating it as one signs people out.** This
 * returned true for every 403 until ticket 18, which was survivable only
 * because a 403 was something an ordinary account never saw: the admin routes
 * it could have hit were open to everybody. Now that they are not, a plain
 * account loading the app calls `GET /data/settings/network`, is correctly
 * refused, and — under the old rule — had its token dropped and was hard
 * navigated to `/login`, on every attempt, forever. A permission error is not
 * an authentication error, and the difference is not cosmetic: 401 means "I do
 * not know who you are", 403 means "I do, and no".
 *
 * The two exceptions stay, because both really do mean the session cannot be
 * used again: an account switched off mid-session, and a token whose subject
 * has been deleted.
 *
 * This also stops signing out an account that is merely awaiting approval,
 * which is what ADR-011 always said should happen — every data router refuses
 * those with `PENDING_APPROVAL_DETAIL` precisely so the app can show the
 * pending page instead of a permission error.
 */
export function isAuthFailure(status: number, detail: string): boolean {
  return (
    status === 401 ||
    (status === 403 && detail === INACTIVE_USER_DETAIL) ||
    (status === 404 && detail === "User not found")
  )
}

/**
 * Drop a session the server has stopped accepting.
 *
 * The `queryClient.clear()` is not decoration. This used to rely on the hard
 * `window.location.href` below to discard the previous account's cached
 * channels, posts and logs — which works, but only on the branch that takes it:
 * a session expiring while the operator is already sitting on `/login` left the
 * whole cache intact. Clearing explicitly makes it true on both branches, and
 * stops the hard navigation from being load-bearing for something it never
 * mentions.
 */
export function clearStaleSession(): void {
  if (!localStorage.getItem(TOKEN_STORAGE_KEY)) return
  localStorage.removeItem(TOKEN_STORAGE_KEY)
  queryClient.clear()
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login"
  }
}

export async function parseErrorDetail(response: Response): Promise<string> {
  const err = await response
    .json()
    .catch(() => ({ detail: response.statusText }))
  return typeof err.detail === "string" ? err.detail : JSON.stringify(err)
}

export function handleAuthError(status: number, detail: string): void {
  if (isAuthFailure(status, detail)) {
    clearStaleSession()
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`
  const response = await fetch(url, {
    ...init,
    headers: { ...headers(), ...(init?.headers as Record<string, string>) },
  })
  if (!response.ok) {
    const detail = await parseErrorDetail(response)
    handleAuthError(response.status, detail)
    throw new ApiError(response.status, detail)
  }
  return response.json() as Promise<T>
}

export async function requestBlob(path: string): Promise<Blob> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`
  const response = await fetch(url, { headers: headers(false) })
  if (!response.ok) {
    const detail = await parseErrorDetail(response)
    handleAuthError(response.status, detail)
    throw new ApiError(response.status, detail)
  }
  return response.blob()
}

/** Parse SSE `data:` lines and yield each JSON object payload. */
export async function* sseJsonStream<T>(
  path: string,
  init?: RequestInit,
): AsyncGenerator<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`
  const response = await fetch(url, {
    ...init,
    headers: {
      ...headers(false),
      ...(init?.headers as Record<string, string>),
    },
  })
  if (!response.ok) {
    const detail = await parseErrorDetail(response)
    handleAuthError(response.status, detail)
    throw new ApiError(response.status, detail)
  }
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const payload = line.slice(6)
      if (payload === "[DONE]") return
      try {
        yield JSON.parse(payload) as T
      } catch {
        /* ignore malformed SSE chunks */
      }
    }
  }
}

/** Parse SSE `data:` lines and yield JSON payload fields. */
export async function* sseTextStream(
  path: string,
  body: Record<string, unknown>,
  field: string,
): AsyncGenerator<string> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`
  const response = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await parseErrorDetail(response)
    handleAuthError(response.status, detail)
    throw new ApiError(response.status, detail)
  }
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const payload = line.slice(6)
      if (payload === "[DONE]") return
      try {
        const parsed = JSON.parse(payload)
        if (parsed[field]) yield parsed[field]
      } catch {
        /* ignore malformed SSE chunks */
      }
    }
  }
}

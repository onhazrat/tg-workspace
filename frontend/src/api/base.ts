export const API_BASE = import.meta.env.VITE_API_URL || ""
const API_KEY = import.meta.env.VITE_API_KEY || ""

export function headers(json = true): HeadersInit {
  const h: Record<string, string> = {}
  if (json) h["Content-Type"] = "application/json"
  if (API_KEY) h["X-API-Key"] = API_KEY
  const token = localStorage.getItem("access_token")
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

export function isAuthFailure(status: number, detail: string): boolean {
  return (
    status === 401 ||
    status === 403 ||
    (status === 404 && detail === "User not found")
  )
}

export function clearStaleSession(): void {
  if (!localStorage.getItem("access_token")) return
  localStorage.removeItem("access_token")
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
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export async function requestBlob(path: string): Promise<Blob> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`
  const response = await fetch(url, { headers: headers(false) })
  if (!response.ok) {
    const detail = await parseErrorDetail(response)
    handleAuthError(response.status, detail)
    throw new Error(detail)
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
    throw new Error(detail)
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
    throw new Error(detail)
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

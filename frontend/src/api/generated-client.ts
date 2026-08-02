import { client } from "@/client/client.gen"
import { API_BASE, ApiError, handleAuthError, headers } from "./base"

/**
 * Wire the generated client (`src/client/`) into this app's transport.
 *
 * ADR-006 keeps two API clients. It does not require them to be configured
 * twice: base URL, auth header and API key all come from `./base`, so there is
 * exactly one place that knows how this app authenticates.
 *
 * ## Why an error interceptor exists
 *
 * `@hey-api/client-fetch` throws the *parsed response body* — a plain object
 * like `{detail: "..."}` — not an `Error`. That loses two things the app needs:
 *
 * - **the status**, which is not on the body at all, and which
 *   `isAuthFailure()` needs to tell a stale session from a server fault;
 * - **`instanceof Error`**, which react-query, `utils.ts` and every `catch`
 *   branch in the app assume.
 *
 * The interceptor is the only place with both the body and the `Response`, so
 * it is where the two are recombined into an `ApiError`. Returning it here is
 * what gets thrown, because the client throws whatever the interceptor chain
 * produced.
 *
 * Auth handling happens here too, matching what `base.ts`'s `request()` already
 * did for the hand-written client — so a 401 clears the session no matter which
 * client saw it, and no global react-query error handler is needed.
 */
export function configureGeneratedClient(): void {
  client.setConfig({ baseUrl: API_BASE })

  client.interceptors.request.use((request: Request) => {
    for (const [key, value] of Object.entries(
      headers(false) as Record<string, string>,
    )) {
      request.headers.set(key, value)
    }
    return request
  })

  client.interceptors.error.use((error: unknown, response: Response) => {
    const detail = errorDetail(error, response)
    handleAuthError(response.status, detail)
    return new ApiError(response.status, detail, error)
  })
}

/**
 * The FastAPI `detail` out of an already-parsed error body.
 *
 * Mirrors `base.ts`'s `parseErrorDetail`, which cannot be reused: that one
 * reads the `Response`, and by this point the client has consumed the body and
 * handed us the parsed value.
 */
function errorDetail(error: unknown, response: Response): string {
  if (error && typeof error === "object" && "detail" in error) {
    const { detail } = error as { detail: unknown }
    if (typeof detail === "string") return detail
  }
  if (typeof error === "string" && error) return error
  if (error && typeof error === "object") return JSON.stringify(error)
  // A gateway 502 or a proxy timeout arrives as an empty body *and* an empty
  // `statusText`, so neither can be the last resort — an error whose message is
  // "" surfaces as a blank toast with nothing to act on.
  return response.statusText || `HTTP ${response.status}`
}

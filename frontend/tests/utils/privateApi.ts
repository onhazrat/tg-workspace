/**
 * Create a test user through the backend's `/private` route.
 *
 * **Deliberately a bare `fetch`, not a generated client call.** `/private`
 * mounts only when `ENVIRONMENT == "local"`, but `scripts/generate-client.sh`
 * exports the spec with `ENVIRONMENT=production` on purpose, so the committed
 * `openapi.json` has no `/private` path and the generated client can never
 * contain a function for it. This file imported one anyway
 * (`OpenAPI` + `PrivateService.createUser`), so it threw at *import* time and
 * took `admin.spec.ts` down with it — a break that predates
 * F1b and that F1b only made louder, by removing `OpenAPI` too.
 *
 * Going through `fetch` makes the util independent of how the spec was
 * generated, which is the only way it can be correct in both modes.
 */

const apiBase =
  process.env.VITE_API_URL ||
  process.env.PLAYWRIGHT_API_URL ||
  "http://localhost:8000"

export interface CreatedUser {
  id: string
  email: string
  full_name: string | null
  is_active: boolean
  is_superuser: boolean
}

export const createUser = async ({
  email,
  password,
}: {
  email: string
  password: string
}): Promise<CreatedUser> => {
  const response = await fetch(`${apiBase}/api/v1/private/users/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.VITE_API_KEY
        ? { "X-API-Key": process.env.VITE_API_KEY }
        : {}),
    },
    body: JSON.stringify({
      email,
      password,
      is_verified: true,
      full_name: "Test User",
    }),
  })

  if (!response.ok) {
    throw new Error(
      `POST /api/v1/private/users/ failed with ${response.status}: ` +
        `${await response.text()}. This route only exists when the backend ` +
        `runs with ENVIRONMENT=local.`,
    )
  }

  return (await response.json()) as CreatedUser
}

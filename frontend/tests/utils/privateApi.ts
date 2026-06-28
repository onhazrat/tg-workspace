// Note: the `PrivateService` is only available when generating the client
// for local environments
import { OpenAPI, PrivateService } from "../../src/client"

const apiBase =
  process.env.VITE_API_URL ||
  process.env.PLAYWRIGHT_API_URL ||
  "http://localhost:8000"
OpenAPI.BASE = apiBase

export const createUser = async ({
  email,
  password,
}: {
  email: string
  password: string
}) => {
  return await PrivateService.createUser({
    requestBody: {
      email,
      password,
      is_verified: true,
      full_name: "Test User",
    },
  })
}

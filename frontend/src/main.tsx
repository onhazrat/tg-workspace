import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { clearStaleSession, isAuthFailure } from "@/api/base"
import { ApiError, OpenAPI } from "@/client"
import { ThemeProvider } from "@/components/theme-provider"
import { routeTree } from "@/routeTree.gen"
import "./index.css"

// Safely override showPicker to prevent SecurityError in cross-origin iframes
if (
  typeof HTMLSelectElement !== "undefined" &&
  HTMLSelectElement.prototype.showPicker
) {
  const originalSelectShowPicker = HTMLSelectElement.prototype.showPicker
  HTMLSelectElement.prototype.showPicker = function () {
    try {
      originalSelectShowPicker.call(this)
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "SecurityError") {
        console.warn("showPicker() blocked by cross-origin iframe policy.")
      } else {
        throw e
      }
    }
  }
}

if (
  typeof HTMLInputElement !== "undefined" &&
  HTMLInputElement.prototype.showPicker
) {
  const originalInputShowPicker = HTMLInputElement.prototype.showPicker
  HTMLInputElement.prototype.showPicker = function () {
    try {
      originalInputShowPicker.call(this)
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "SecurityError") {
        console.warn("showPicker() blocked by cross-origin iframe policy.")
      } else {
        throw e
      }
    }
  }
}

OpenAPI.BASE = import.meta.env.VITE_API_URL || ""
OpenAPI.TOKEN = async () => localStorage.getItem("access_token") || ""

const apiKey = import.meta.env.VITE_API_KEY
if (apiKey) {
  OpenAPI.HEADERS = { "X-API-Key": apiKey }
}

const handleApiError = (error: Error) => {
  const status = error instanceof ApiError ? error.status : 401
  const detail = error instanceof Error ? error.message : String(error)
  if (localStorage.getItem("access_token") && isAuthFailure(status, detail)) {
    clearStaleSession()
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleApiError }),
  mutationCache: new MutationCache({ onError: handleApiError }),
})

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)

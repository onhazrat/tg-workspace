import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { configureGeneratedClient } from "@/api/generated-client"
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

configureGeneratedClient()

// No `QueryCache`/`MutationCache` `onError` here on purpose. It used to clear a
// stale session, but it could only read a status off the generated client's
// errors and **defaulted everything else to 401** — so any failing summarizer
// query, including a plain 500, logged the operator out. Both clients now
// detect an auth failure at the transport, where the real status is (see
// `api/base.ts` and `api/generated-client.ts`).
const queryClient = new QueryClient()

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

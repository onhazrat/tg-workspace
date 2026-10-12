/** PROTOTYPE (variant A): a Posts filter editor draws the server's bars and a drag sets its bound. */
import { afterEach, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PostViewsEditor } from "@/components/PostFilterControls"
import { ValueHistogramContext } from "./ValueHistogram"
import { PostsVariantContext } from "./variant"

afterEach(cleanup)

const bins = Array.from({ length: 32 }, (_, i) => i + 1)
const edges = Array.from({ length: 33 }, (_, i) => i * 100)

function mount(variant: "0" | "A") {
  const submitted: unknown[] = []
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PostsVariantContext.Provider value={variant}>
        <ValueHistogramContext.Provider
          value={{
            key: [],
            fetch: async () => ({
              bins,
              edges,
              log: false,
              median: 1600,
              measured: 528,
              total: 600,
            }),
          }}
        >
          <PostViewsEditor
            measure="views"
            floorHours={3}
            onSubmit={(cond) => submitted.push(cond)}
          />
        </ValueHistogramContext.Provider>
      </PostsVariantContext.Provider>
    </QueryClientProvider>,
  )
  return submitted
}

test("a drag over the first four bars adds at most their upper edge", async () => {
  const submitted = mount("A")
  await screen.findByTestId("metric-bar-0")
  expect(screen.getByTestId("metric-histogram-caption").textContent).toContain(
    "median 1.6K",
  )
  fireEvent.pointerDown(screen.getByTestId("metric-bar-0"))
  fireEvent.pointerEnter(screen.getByTestId("metric-bar-3"))
  fireEvent.pointerUp(screen.getByTestId("metric-bar-3"))
  fireEvent.click(screen.getByTestId("post-views-editor-submit"))
  expect(submitted).toEqual([{ type: "views", measure: "views", max: 400 }])
})

test("variant 0 draws no histogram", async () => {
  mount("0")
  await new Promise((r) => setTimeout(r, 10))
  expect(screen.queryByTestId("metric-bar-0")).toBeNull()
})

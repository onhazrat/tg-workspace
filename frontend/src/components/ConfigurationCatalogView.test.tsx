import { afterEach, describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ConfigurationCatalogResponse } from "@/client"
import { queryKeys } from "@/hooks/queryKeys"
import { ConfigurationCatalogView } from "./ConfigurationCatalogView"

afterEach(cleanup)

const catalog = {
  layers: [
    {
      id: "deployment",
      label: "Deployment",
      description: "env",
      entries: [
        {
          id: "deployment.SECRET_KEY",
          key: "SECRET_KEY",
          label: "Secret",
          layer: "deployment",
          value: "••••••",
          defaultValue: null,
          source: "environment",
          description: "Signs tokens",
          sensitive: true,
          configured: true,
          restartRequired: true,
        },
        {
          id: "deployment.LIMITS",
          key: "LIMITS",
          label: "Limits",
          layer: "deployment",
          value: { max: 3 },
          defaultValue: 5,
          source: "settings row",
          ownerId: "user-1",
          editable: true,
        },
      ],
    },
    {
      id: "frontend",
      label: "Frontend",
      description: "build",
      entries: [
        {
          id: "frontend.VITE_X",
          key: "VITE_UNSET_FOR_TEST",
          label: "X",
          layer: "frontend",
          defaultValue: "",
          source: "",
          sensitive: true,
        },
      ],
    },
  ],
} as unknown as ConfigurationCatalogResponse

function renderSeeded() {
  const client = new QueryClient()
  client.setQueryData(queryKeys.configurationCatalog, catalog)
  return render(
    <QueryClientProvider client={client}>
      <ConfigurationCatalogView />
    </QueryClientProvider>,
  )
}

describe("ConfigurationCatalogView", () => {
  test("renders every entry with its badges, value and default", () => {
    renderSeeded()
    expect(screen.getByText("SECRET_KEY")).toBeTruthy()
    expect(screen.getAllByText("redacted")).toHaveLength(2)
    expect(screen.getByText("restart/rebuild")).toBeTruthy()
    expect(screen.getByText("runtime editable")).toBeTruthy()
    expect(screen.getByText("owner: user-1")).toBeTruthy()
    expect(screen.getByText("default: 5")).toBeTruthy()
    // The frontend layer is re-derived from the build, not the server row.
    expect(screen.getByText("source: code default")).toBeTruthy()
    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0)
  })

  test("search and the layer filter narrow the list", () => {
    renderSeeded()
    fireEvent.change(screen.getByLabelText("Search configuration catalog"), {
      target: { value: "user-1" },
    })
    expect(screen.queryByText("SECRET_KEY")).toBeNull()
    expect(screen.getByText("LIMITS")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Search configuration catalog"), {
      target: { value: "" },
    })
    fireEvent.click(screen.getByRole("button", { name: "frontend" }))
    expect(screen.queryByText("LIMITS")).toBeNull()
    expect(screen.getByText("VITE_UNSET_FOR_TEST")).toBeTruthy()
  })
})

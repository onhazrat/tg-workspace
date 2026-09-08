import { describe, expect, it } from "bun:test"
import type { ConfigurationCatalog } from "@/api"
import type { CommandContext } from "@/lib/commands/types"
import { buildConfigurationCommands } from "./configuration-commands"

const catalog: ConfigurationCatalog = {
  schema_version: 1,
  layers: [
    {
      id: "deployment",
      label: "Deployment environment",
      description: "",
      entries: [
        {
          id: "deployment:POSTGRES_SERVER",
          key: "POSTGRES_SERVER",
          label: "Postgres Server",
          layer: "deployment",
          value: "localhost",
          default_value: null,
          source: "environment",
          description: "Database host",
          sensitive: false,
          configured: true,
          editable: false,
          restart_required: true,
          owner_id: null,
        },
      ],
    },
  ],
}

describe("configuration palette commands", () => {
  it("creates one searchable destination per catalog entry", async () => {
    const opened: string[] = []
    const commands = buildConfigurationCommands(catalog)
    expect(commands).toHaveLength(1)
    expect(commands[0]?.label).toBe("Open config → POSTGRES_SERVER")
    expect(commands[0]?.keywords).toContain("deployment")

    await commands[0]?.run({
      openConfigurationEntry: (id) => opened.push(id),
    } as CommandContext)
    expect(opened).toEqual(["deployment:POSTGRES_SERVER"])
  })
})

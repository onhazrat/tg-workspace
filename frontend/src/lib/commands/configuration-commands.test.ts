import { describe, expect, it } from "bun:test"
import type { ConfigurationCatalogResponse } from "@/client"
import { getExtendedEntityCandidates } from "@/lib/commands/entity-candidates"
import type { CommandContext } from "@/lib/commands/types"
import { buildConfigurationCommands } from "./configuration-commands"

const catalog: ConfigurationCatalogResponse = {
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
  it("creates one lazy browser instead of flooding the root command list", async () => {
    const opened: string[] = []
    const commands = buildConfigurationCommands(catalog)
    expect(commands).toHaveLength(1)
    expect(commands[0]?.label).toBe("Browse Configuration")
    expect(commands[0]?.entityFlow).toBe("open-configuration")
    expect(commands[0]?.keywords).toContain("POSTGRES_SERVER")

    await commands[0]?.run(
      {
        openConfigurationEntry: (id) => opened.push(id),
      } as CommandContext,
      "deployment:POSTGRES_SERVER",
    )
    expect(opened).toEqual(["deployment:POSTGRES_SERVER"])

    expect(
      getExtendedEntityCandidates("open-configuration", {
        configurationCatalog: catalog,
      } as CommandContext),
    ).toEqual([
      {
        id: "deployment:POSTGRES_SERVER",
        label: "[deployment] POSTGRES_SERVER",
      },
    ])
  })
})

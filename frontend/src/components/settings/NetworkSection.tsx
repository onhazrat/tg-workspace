import type React from "react"
import { ProxyPanel } from "./network/ProxyPanel"
import { TorPanel } from "./network/TorPanel"
import { SettingAnchor } from "./SettingAnchor"

export const NetworkSection: React.FC<{
  focus?: "network" | "proxy" | "tor"
  highlightId?: string | null
}> = ({ focus = "network", highlightId = null }) => {
  return (
    <div className="space-y-8 lg:col-span-2">
      {(focus === "network" || focus === "proxy") && (
        <SettingAnchor
          settingId="panel-proxy"
          highlighted={highlightId === "panel-proxy"}
        >
          <ProxyPanel highlightId={highlightId} />
        </SettingAnchor>
      )}
      {(focus === "network" || focus === "tor") && (
        <SettingAnchor
          settingId="panel-tor"
          highlighted={highlightId === "panel-tor"}
        >
          <TorPanel highlightId={highlightId} />
        </SettingAnchor>
      )}
    </div>
  )
}

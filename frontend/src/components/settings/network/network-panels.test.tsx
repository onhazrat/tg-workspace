/**
 * The pieces the Proxy and Tor panels are assembled from. Each takes props
 * only; the settings, the polling and the network calls stay in the panels.
 *
 * What is pinned is what the panels did before they were split: proxy
 * credentials stay masked and read-only until revealed, a test result shows
 * only against a line still in the list, slot counts and the rotation
 * threshold clamp, and the Tor controls appear only once they apply.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  BlacklistedProxies,
  clampSlots,
  formatCooldown,
  ProxyListEditor,
  ProxySlots,
} from "./ProxyPanelSections"
import { ProxyTestResults, testedProxies } from "./ProxyTestResults"
import {
  clampRotationThreshold,
  TorControlSection,
  TorExitIp,
  TorModeField,
  TorNetworkStatus,
  TorProxyPool,
  TorQuickActions,
  TorStatusIndicator,
  TorStrategyField,
} from "./TorPanelSections"

afterEach(cleanup)

const SECRET_LIST = "http://user:hunter2@10.0.0.1:8080\nsocks5h://10.0.0.2:1080"

describe("proxy test results", () => {
  const results = {
    "10.0.0.1:9050": { success: true, latency: 120, ip: "1.2.3.4" },
    "10.0.0.2:9050": { testing: true },
    "10.0.0.3:9050": { success: false, error: "timeout" },
    "gone:1": { success: true, latency: 1, ip: "x" },
  }

  test("only lines still in the list, in list order", () => {
    expect(
      testedProxies(
        " 10.0.0.3:9050 ,10.0.0.1:9050\n\nnew:1\n10.0.0.2:9050",
        results,
      ),
    ).toEqual(["10.0.0.3:9050", "10.0.0.1:9050", "10.0.0.2:9050"])
    expect(testedProxies("new:1", results)).toEqual([])
  })

  test("renders nothing without a result for the list", () => {
    const { container } = render(
      <ProxyTestResults list="new:1" results={results} />,
    )
    expect(container.innerHTML).toBe("")
  })

  test("shows latency and IP, the error on hover, or that it is running", () => {
    render(
      <ProxyTestResults
        list={"10.0.0.1:9050\n10.0.0.2:9050\n10.0.0.3:9050"}
        results={results}
        display={(url) => `shown:${url}`}
      />,
    )
    const rows = screen.getAllByTestId("proxy-test-result")
    expect(rows.map((r) => r.textContent)).toEqual([
      "shown:10.0.0.1:9050 120ms(1.2.3.4)",
      "shown:10.0.0.2:9050 Testing...",
      "shown:10.0.0.3:9050 Error",
    ])
    expect(screen.getByTitle("timeout")).toBeTruthy()
  })
})

describe("ProxyListEditor", () => {
  const props = {
    onChange: () => {},
    onRevealedChange: () => {},
    hasResults: false,
    onClearResults: () => {},
    isTestingAll: false,
    onTestAll: () => {},
    highlightId: null,
  }
  const textarea = () => screen.getByRole("textbox") as HTMLTextAreaElement

  test("a list with credentials is masked and read-only until revealed", () => {
    const onRevealedChange = mock(() => {})
    const { rerender } = render(
      <ProxyListEditor
        {...props}
        urls={SECRET_LIST}
        revealed={false}
        onRevealedChange={onRevealedChange}
      />,
    )
    expect(textarea().value).not.toContain("hunter2")
    expect(textarea().readOnly).toBe(true)
    expect(screen.getByText(/Credentials are hidden/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Reveal proxy credentials to edit"))
    expect(onRevealedChange).toHaveBeenCalledWith(true)

    rerender(
      <ProxyListEditor
        {...props}
        urls={SECRET_LIST}
        revealed={true}
        onRevealedChange={onRevealedChange}
      />,
    )
    expect(textarea().value).toBe(SECRET_LIST)
    expect(textarea().readOnly).toBe(false)
    expect(screen.queryByText(/Credentials are hidden/)).toBeNull()
    // Leaving the field hides them again.
    fireEvent.blur(textarea())
    expect(onRevealedChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByLabelText("Hide proxy credentials")).toBeTruthy()
  })

  test("a list without credentials has no reveal and edits directly", () => {
    const onChange = mock(() => {})
    render(
      <ProxyListEditor
        {...props}
        urls="socks5h://10.0.0.2:1080"
        revealed={false}
        onChange={onChange}
      />,
    )
    expect(screen.queryByLabelText(/proxy credentials/)).toBeNull()
    expect(textarea().readOnly).toBe(false)
    fireEvent.change(textarea(), { target: { value: "x:1" } })
    expect(onChange).toHaveBeenCalledWith("x:1")
  })

  test("Clear appears only with results; Test All always", () => {
    const onClearResults = mock(() => {})
    const onTestAll = mock(() => {})
    const { rerender } = render(
      <ProxyListEditor
        {...props}
        urls=""
        revealed={false}
        onTestAll={onTestAll}
      />,
    )
    expect(screen.queryByText("Clear")).toBeNull()
    fireEvent.click(screen.getByText("Test All"))
    expect(onTestAll).toHaveBeenCalledTimes(1)
    rerender(
      <ProxyListEditor
        {...props}
        urls=""
        revealed={false}
        hasResults
        onClearResults={onClearResults}
      />,
    )
    fireEvent.click(screen.getByText("Clear"))
    expect(onClearResults).toHaveBeenCalledTimes(1)
  })
})

describe("ProxySlots", () => {
  test("slot counts clamp to 1..20 and anything unparsable is 1", () => {
    expect(clampSlots("0")).toBe(1)
    expect(clampSlots("7")).toBe(7)
    expect(clampSlots("99")).toBe(20)
    expect(clampSlots("")).toBe(1)
  })

  test("overrides are keyed by the normalised proxy and shown masked", () => {
    const onOverridesChange = mock(() => {})
    const onDefaultSlotsChange = mock(() => {})
    render(
      <ProxySlots
        proxies={["http://user:hunter2@10.0.0.1:8080", "10.0.0.9:3128"]}
        defaultSlots={2}
        onDefaultSlotsChange={onDefaultSlotsChange}
        overrides={{ "http://other:1": 3 }}
        onOverridesChange={onOverridesChange}
        display={(url) => (url.includes("@") ? "masked" : url)}
        highlightId={null}
      />,
    )
    expect(screen.getByText("masked")).toBeTruthy()
    expect(screen.queryByText(/hunter2/)).toBeNull()
    const [defaults, , bare] = screen.getAllByRole("spinbutton")
    fireEvent.change(defaults, { target: { value: "50" } })
    expect(onDefaultSlotsChange).toHaveBeenCalledWith(20)
    // A bare host:port is stored under its normalised http:// form, and the
    // other overrides are kept.
    fireEvent.change(bare, { target: { value: "5" } })
    expect(onOverridesChange).toHaveBeenCalledWith({
      "http://other:1": 3,
      "http://10.0.0.9:3128": 5,
    })
    expect(screen.getByTestId("proxy-capacity").textContent).toContain(
      "≈ 4 slots.",
    )
  })

  test("no proxies: no overrides, and capacity falls back to the default", () => {
    render(
      <ProxySlots
        proxies={[]}
        defaultSlots={1}
        onDefaultSlotsChange={() => {}}
        overrides={{}}
        onOverridesChange={() => {}}
        display={(u) => u}
        highlightId={null}
      />,
    )
    expect(screen.queryByText("Per-proxy overrides")).toBeNull()
    expect(screen.getByTestId("proxy-capacity").textContent).toContain(
      "≈ 1 slot.",
    )
  })
})

describe("BlacklistedProxies", () => {
  test("renders nothing when no proxy is cooling down", () => {
    const { container } = render(<BlacklistedProxies proxies={[]} />)
    expect(container.innerHTML).toBe("")
  })

  test("shows each proxy with its cooldown as m:ss", () => {
    expect(formatCooldown(65)).toBe("1:05")
    expect(formatCooldown(9)).toBe("0:09")
    render(
      <BlacklistedProxies
        proxies={[{ url: "10.0.0.1:8080", cooldownRemaining: 125 }]}
      />,
    )
    expect(screen.getByTestId("blacklisted-proxy").textContent).toBe(
      "10.0.0.1:80802:05",
    )
  })
})

describe("Tor status", () => {
  test("running reads Active; stopped reads Inactive and Offline", () => {
    const { rerender } = render(
      <>
        <TorStatusIndicator running />
        <TorNetworkStatus running controlConnected />
      </>,
    )
    expect(screen.getAllByText("Active")).toHaveLength(2)
    expect(screen.getByText("Control Connected")).toBeTruthy()
    rerender(
      <>
        <TorStatusIndicator running={false} />
        <TorNetworkStatus running={false} controlConnected={false} />
      </>,
    )
    expect(screen.getByText("Inactive")).toBeTruthy()
    expect(screen.getByText("Offline")).toBeTruthy()
    expect(screen.queryByText("Control Connected")).toBeNull()
  })

  test("Check IP needs Tor running; the exit IP shows once known", () => {
    const onCheckIp = mock(() => {})
    const onRestart = mock(() => {})
    const { rerender } = render(
      <TorQuickActions
        onRestart={onRestart}
        onCheckIp={onCheckIp}
        running={false}
        isCheckingIp={false}
      />,
    )
    const checkIp = () =>
      screen.getByText("Check IP").closest("button") as HTMLButtonElement
    expect(checkIp().disabled).toBe(true)
    fireEvent.click(screen.getByText("Restart"))
    expect(onRestart).toHaveBeenCalledTimes(1)
    rerender(
      <TorQuickActions
        onRestart={onRestart}
        onCheckIp={onCheckIp}
        running
        isCheckingIp={false}
      />,
    )
    fireEvent.click(checkIp())
    expect(onCheckIp).toHaveBeenCalledTimes(1)

    const ip = render(<TorExitIp ip={null} />)
    expect(ip.container.textContent).toBe("")
    ip.rerender(<TorExitIp ip="5.6.7.8" />)
    expect(ip.container.textContent).toContain("5.6.7.8")
  })
})

describe("Tor mode and pool", () => {
  test("the mode description follows the mode; auto disables the strategy", () => {
    const { rerender } = render(
      <>
        <TorModeField mode="auto" onChange={() => {}} highlightId={null} />
        <TorStrategyField
          mode="auto"
          value="sequential"
          onChange={() => {}}
          highlightId={null}
        />
      </>,
    )
    expect(screen.getByText(/built-in TOR service/)).toBeTruthy()
    const strategy = () =>
      screen.getByRole("button", { name: "random" }) as HTMLButtonElement
    expect(strategy().disabled).toBe(true)
    rerender(
      <>
        <TorModeField mode="custom" onChange={() => {}} highlightId={null} />
        <TorStrategyField
          mode="custom"
          value="sequential"
          onChange={() => {}}
          highlightId={null}
        />
      </>,
    )
    expect(screen.getByText(/multiple external TOR instances/)).toBeTruthy()
    expect(strategy().disabled).toBe(false)
  })

  test("the pool edits, tests, and clears only with results", () => {
    const onChange = mock(() => {})
    const onTestAll = mock(() => {})
    const onClear = mock(() => {})
    const props = {
      urls: "127.0.0.1:9050",
      onChange,
      isTestingAll: false,
      onTestAll,
      onClear,
      highlightId: null,
    }
    const { rerender } = render(<TorProxyPool {...props} results={{}} />)
    expect(screen.queryByText("Clear")).toBeNull()
    expect(screen.queryByTestId("proxy-test-result")).toBeNull()
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "127.0.0.1:9052" },
    })
    expect(onChange).toHaveBeenCalledWith("127.0.0.1:9052")
    fireEvent.click(screen.getByText("Test All"))
    expect(onTestAll).toHaveBeenCalledTimes(1)
    rerender(
      <TorProxyPool
        {...props}
        results={{ "127.0.0.1:9050": { success: true, latency: 5, ip: "x" } }}
      />,
    )
    // Tor pool lines are host:port and shown as typed.
    expect(screen.getByTestId("proxy-test-result").textContent).toContain(
      "127.0.0.1:9050",
    )
    fireEvent.click(screen.getByText("Clear"))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})

describe("TorControlSection", () => {
  const props = {
    highlightId: null,
    controlEnabled: true,
    onControlEnabledChange: () => {},
    controlPort: 9051,
    onControlPortChange: () => {},
    controlConnected: false,
    isChangingIp: false,
    onNewIdentity: () => {},
    autoRotate: false,
    onAutoRotateChange: () => {},
    rotationThreshold: 10,
    onRotationThresholdChange: () => {},
  }

  test("the threshold clamps to 5..50 and ignores a non-number", () => {
    expect(clampRotationThreshold("1")).toBe(5)
    expect(clampRotationThreshold("20")).toBe(20)
    expect(clampRotationThreshold("99")).toBe(50)
    expect(clampRotationThreshold("")).toBeNull()
  })

  test("switched off, only the switch shows", () => {
    const onControlEnabledChange = mock(() => {})
    render(
      <TorControlSection
        {...props}
        controlEnabled={false}
        onControlEnabledChange={onControlEnabledChange}
      />,
    )
    expect(screen.queryByText("Control Port")).toBeNull()
    fireEvent.click(screen.getByTestId("tor-control-switch"))
    expect(onControlEnabledChange).toHaveBeenCalledWith(true)
  })

  test("New Identity waits for a connected control port", () => {
    const onNewIdentity = mock(() => {})
    const onControlPortChange = mock(() => {})
    const { rerender } = render(
      <TorControlSection
        {...props}
        onNewIdentity={onNewIdentity}
        onControlPortChange={onControlPortChange}
      />,
    )
    const button = () =>
      screen.getByText("New Identity").closest("button") as HTMLButtonElement
    expect(button().disabled).toBe(true)
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "9151" },
    })
    expect(onControlPortChange).toHaveBeenCalledWith(9151)
    rerender(
      <TorControlSection
        {...props}
        controlConnected
        onNewIdentity={onNewIdentity}
      />,
    )
    fireEvent.click(button())
    expect(onNewIdentity).toHaveBeenCalledTimes(1)
  })

  test("the threshold appears with auto-rotate and sets a clamped value", () => {
    const onAutoRotateChange = mock(() => {})
    const onRotationThresholdChange = mock(() => {})
    const { rerender } = render(
      <TorControlSection {...props} onAutoRotateChange={onAutoRotateChange} />,
    )
    expect(screen.queryByTestId("tor-rotation-threshold")).toBeNull()
    fireEvent.click(screen.getByTestId("tor-auto-rotate-switch"))
    expect(onAutoRotateChange).toHaveBeenCalledWith(true)
    rerender(
      <TorControlSection
        {...props}
        autoRotate
        onRotationThresholdChange={onRotationThresholdChange}
      />,
    )
    const threshold = screen.getByTestId("tor-rotation-threshold")
    fireEvent.change(threshold, { target: { value: "80" } })
    expect(onRotationThresholdChange).toHaveBeenCalledWith(50)
    fireEvent.change(threshold, { target: { value: "" } })
    expect(onRotationThresholdChange).toHaveBeenCalledTimes(1)
  })
})

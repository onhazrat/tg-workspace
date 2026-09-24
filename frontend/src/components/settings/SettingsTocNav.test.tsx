/**
 * The Settings TOC: the active leaf's parent opens on its own, a twistie folds
 * a branch without selecting it, and picking a branch opens it.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { scopedStorage } from "@/lib/storage/scoped"
import { SettingsTocNav } from "./SettingsTocNav"

afterEach(() => {
  cleanup()
  scopedStorage.removeItem("settings-toc-expanded")
})

describe("SettingsTocNav", () => {
  test("a deep-linked leaf opens its parent and is the active row", () => {
    render(<SettingsTocNav activeSection="proxy" onSelect={() => {}} />)
    const twistie = screen.getByTestId("toc-twistie-network")
    expect(twistie.getAttribute("aria-expanded")).toBe("true")
    expect(twistie.getAttribute("aria-label")).toBe("Collapse Network")
    expect(
      screen.getByTestId("toc-section-proxy").parentElement?.className,
    ).toContain("bg-app-ink")
    // Its sibling shows with it; another branch stays folded.
    expect(screen.queryByTestId("toc-section-tor")).toBeTruthy()
    expect(screen.queryByTestId("toc-section-retention")).toBeNull()
  })

  test("a twistie folds without selecting; a branch click selects and opens", () => {
    const onSelect = mock()
    render(<SettingsTocNav activeSection="appearance" onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId("toc-twistie-data"))
    expect(screen.getByTestId("toc-section-retention")).toBeTruthy()
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId("toc-twistie-data"))
    expect(screen.queryByTestId("toc-section-retention")).toBeNull()

    fireEvent.click(screen.getByTestId("toc-section-tools"))
    expect(onSelect).toHaveBeenCalledWith("tools")
    expect(screen.getByTestId("toc-section-diagnostics")).toBeTruthy()
    // The open set survives a remount.
    cleanup()
    render(<SettingsTocNav activeSection="appearance" onSelect={onSelect} />)
    expect(screen.getByTestId("toc-section-diagnostics")).toBeTruthy()
  })
})

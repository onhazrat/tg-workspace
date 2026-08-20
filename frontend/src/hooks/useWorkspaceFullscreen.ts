import { useCallback, useEffect } from "react"

import { useSettings } from "@/contexts/SettingsContext"

/**
 * The workspace fullscreen toggle: native browser fullscreen plus focus mode.
 *
 * Two things happen on one click, because either alone is disappointing.
 * Native fullscreen hides the browser chrome but leaves the app's own — the
 * title block, the stats strip and an 80rem width cap — so on a wide monitor
 * the content barely gains room. Focus mode drops that chrome but leaves the
 * tab bar and the OS window frame. Together they give the whole screen to
 * whichever tab you are on, which is the point.
 *
 * ## Why only one half persists
 *
 * `workspaceFocusMode` is stored; native fullscreen is not, and cannot be.
 * Browsers only honour `requestFullscreen` inside a user gesture, so there is
 * no reload path that restores it — calling it on mount is rejected, and
 * rejected quietly enough that the failure looks like a bug rather than a
 * policy. So a reload comes back with the chrome collapsed and the browser
 * windowed. That is the honest behaviour rather than a compromise: the
 * layout preference survives, the window state does not.
 *
 * ## Why the `fullscreenchange` listener is not optional
 *
 * The two halves can be desynchronised from outside React. Esc, F11 and the
 * window manager all exit native fullscreen without touching our state, which
 * would leave the page chromeless with no visible way back — the exit control
 * lives in the collapsed chrome. Subscribing and clearing focus mode when the
 * browser drops out keeps the pair honest in the one direction that can strand
 * someone.
 */
export function useWorkspaceFullscreen() {
  const { workspaceFocusMode, setWorkspaceFocusMode } = useSettings()

  const isFullscreen = workspaceFocusMode

  useEffect(() => {
    const syncFromBrowser = () => {
      if (!document.fullscreenElement) setWorkspaceFocusMode(false)
    }
    document.addEventListener("fullscreenchange", syncFromBrowser)
    return () =>
      document.removeEventListener("fullscreenchange", syncFromBrowser)
  }, [setWorkspaceFocusMode])

  const toggle = useCallback(async () => {
    const next = !workspaceFocusMode
    // Focus mode is set first and unconditionally. The native request may be
    // refused — an iframe without `allow="fullscreen"`, a browser policy, a
    // user who dismissed the prompt — and when it is, the collapsed chrome is
    // still the thing that was asked for. Failing the whole toggle because the
    // window would not resize would be the worse outcome.
    setWorkspaceFocusMode(next)
    try {
      if (next) {
        await document.documentElement.requestFullscreen?.()
      } else if (document.fullscreenElement) {
        await document.exitFullscreen()
      }
    } catch {
      // Deliberately swallowed: see above.
    }
  }, [workspaceFocusMode, setWorkspaceFocusMode])

  return { isFullscreen, toggle }
}

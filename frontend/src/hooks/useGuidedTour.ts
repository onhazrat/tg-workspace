import { driver } from "driver.js"
import { useCallback, useEffect, useState } from "react"
import "driver.js/dist/driver.css"
import { WORKSPACE_TABS } from "@/constants"
import { scopedStorage } from "@/lib/storage/scoped"
import { isFixed } from "@/lib/workspace-tabs"
import { useData } from "../contexts/DataContext"
import { useUI } from "../contexts/UIContext"

const TOUR_TABS = WORKSPACE_TABS.map((tab) => tab.id).filter(
  (id) => !isFixed(id),
)

export const useGuidedTour = () => {
  const { channels } = useData()
  const {
    workspaceTabs: { setActiveTab, openTabs, snapshot, restore },
  } = useUI()
  const [hasSeenTour, setHasSeenTour] = useState(() => {
    if (typeof window !== "undefined") {
      return scopedStorage.getItem("hasSeenTour") === "true"
    }
    return false
  })

  const startTour = useCallback(() => {
    // The tour points at every tab, most of which a user may have closed. It
    // opens them for the tour and puts the user's own strip back when it ends
    // or is dismissed (TABS-01).
    const saved = snapshot()
    openTabs(TOUR_TABS)
    const driverObj = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      doneBtnText: "Finish",
      nextBtnText: "Next",
      prevBtnText: "Previous",
      onPopoverRender: (_popover, _options) => {
        // Optional: Custom styling or logic when popover renders
      },
      onDestroyStarted: () => {
        if (!hasSeenTour) {
          scopedStorage.setItem("hasSeenTour", "true")
          setHasSeenTour(true)
        }
        driverObj.destroy()
        restore(saved)
      },
      steps: [
        {
          element: "#tour-add-channel",
          onHighlightStarted: () => {
            setActiveTab("channels")
          },
          popover: {
            title: "Add Channels",
            description:
              "Start here! Paste one or more Telegram handles or t.me links, pick a setting group, and follow them in one click.",
            side: "bottom",
            align: "start",
          },
        },
        {
          element: "#tour-channel-grid",
          onHighlightStarted: () => {
            setActiveTab("channels")
          },
          popover: {
            title: "Manage Channels",
            description:
              "Your tracked channels appear here. Click on channels to select them for reading, summarizing, or chatting. The app automatically fetches their latest posts.",
            side: "top",
            align: "center",
          },
        },
        {
          element: "#tour-tab-posts",
          onHighlightStarted: () => {
            setActiveTab("posts")
          },
          popover: {
            title: "Read Posts",
            description:
              "View raw posts from your selected channels. You can set a time-range and apply filters here to narrow down exactly which posts you want to analyze.",
            side: "bottom",
            align: "center",
          },
        },
        {
          element: "#tour-tab-summary",
          onHighlightStarted: () => {
            setActiveTab("summary")
          },
          popover: {
            title: "AI Summaries",
            description:
              "Generate intelligent, categorized summaries of the posts you've selected and filtered using Google Gemini.",
            side: "bottom",
            align: "center",
          },
        },
        {
          element: "#tour-tab-tag",
          onHighlightStarted: () => {
            setActiveTab("tag")
          },
          popover: {
            title: "Tag Channels",
            description:
              "Use AI to suggest tags for your selected channels, then preview and apply changes in bulk.",
            side: "bottom",
            align: "center",
          },
        },
        {
          element: "#tour-tab-discover",
          onHighlightStarted: () => {
            setActiveTab("discover")
          },
          popover: {
            title: "Discover Forward Sources",
            description:
              "See which channels your sources forward from, how often, and follow new ones directly from the results.",
            side: "bottom",
            align: "center",
          },
        },
        {
          element: "#tour-tab-chat",
          onHighlightStarted: () => {
            setActiveTab("chat")
          },
          popover: {
            title: "Chat with Data",
            description:
              "Ask questions about your synced data. You can send all filtered posts directly to the AI, or use RAG to only send relevant posts (RAG requires enabling Embeddings in Advanced Settings).",
            side: "bottom",
            align: "center",
          },
        },
        {
          element: "#tour-tab-history",
          onHighlightStarted: () => {
            setActiveTab("history")
          },
          popover: {
            title: "History",
            description:
              "Selecting an item in history will automatically apply its channel selection and post-filtration. You can regenerate the summary via different settings or chat with those specific posts.",
            side: "bottom",
            align: "center",
          },
        },
        {
          element: "#tour-tab-settings",
          onHighlightStarted: () => {
            setActiveTab("settings")
          },
          popover: {
            title: "Settings & Proxies",
            description:
              "Configure AI models, proxies, TOR, and advanced network settings here.",
            side: "bottom",
            align: "center",
          },
        },
        {
          element: "#tour-help-button",
          popover: {
            title: "Revisit Tour",
            description:
              "Need a refresher? Click here anytime to replay this tour. Happy tracking!",
            side: "left",
            align: "center",
          },
        },
      ],
    })

    setActiveTab("channels")
    setTimeout(() => {
      driverObj.drive()
    }, 100)
  }, [hasSeenTour, setActiveTab, openTabs, snapshot, restore])

  // Auto-start tour on first visit if no channels exist
  useEffect(() => {
    if (!hasSeenTour && channels.length === 0) {
      // Small delay to ensure UI is fully rendered
      const timer = setTimeout(() => {
        startTour()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [hasSeenTour, channels.length, startTour])

  return { startTour, hasSeenTour }
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react"

type UseScrollLoadMoreArgs = {
  scrollContainerRef: RefObject<HTMLElement | null>
  enabled: boolean
  hasMore: boolean
  onLoadMore: () => void
}

export function useScrollLoadMore({
  scrollContainerRef,
  enabled,
  hasMore,
  onLoadMore,
}: UseScrollLoadMoreArgs) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const onLoadMoreRef = useRef(onLoadMore)

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  }, [onLoadMore])

  const disconnectObserver = useCallback(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
  }, [])

  const attachObserver = useCallback(() => {
    disconnectObserver()

    if (!enabled || !hasMore) return

    const root = scrollContainerRef.current
    const target = sentinelRef.current
    if (!root || !target) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMoreRef.current()
        }
      },
      { root, threshold: 0, rootMargin: "200px" },
    )

    observer.observe(target)
    observerRef.current = observer
  }, [disconnectObserver, enabled, hasMore, scrollContainerRef])

  const setSentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      sentinelRef.current = node
      attachObserver()
    },
    [attachObserver],
  )

  useLayoutEffect(() => {
    attachObserver()
    return disconnectObserver
  }, [attachObserver, disconnectObserver])

  return setSentinelRef
}

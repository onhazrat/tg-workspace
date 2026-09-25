import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { PostFeedResults } from "./PostFeedResults"

// A non-empty feed mounts PostCard, which needs the app's providers, so only
// the two states without posts render here.
const render = (isInitialLoading: boolean) =>
  renderToStaticMarkup(
    <PostFeedResults
      isInitialLoading={isInitialLoading}
      posts={[]}
      showLoadMore
      loadMoreRef={{ current: null }}
      postSearch=""
    />,
  )

describe("PostFeedResults", () => {
  test("shows skeletons, not the empty state, on the first load", () => {
    const html = render(true)
    expect(html).toContain('data-slot="skeleton"')
    expect(html).not.toContain("No Posts in Range")
  })

  test("shows the empty state once a load returns nothing", () => {
    const html = render(false)
    expect(html).toContain("No Posts in Range")
    // No sentinel without posts, even if the server says more exist.
    expect(html).not.toContain("Loading more posts")
  })
})

/**
 * PROTOTYPE (post-card): the Posts filter tree for the A-plus-select variant.
 * In memory, so a reload clears it; the real one belongs in the URL as the
 * Channel filter is (`?channelFilter=`). Nothing sends it to the server: the
 * staging API has no `filter` field, so the feed runs it on loaded pages.
 */
import { createContext, type ReactNode, useContext, useState } from "react"
import {
  emptyPostFilter,
  type PostFilterTree,
} from "@/lib/posts/post-filter-tree"

const PostFilterTreeContext = createContext<{
  tree: PostFilterTree
  setTree: (next: PostFilterTree) => void
}>({ tree: emptyPostFilter(), setTree: () => {} })

export function PostFilterTreeProvider({ children }: { children: ReactNode }) {
  const [tree, setTree] = useState(emptyPostFilter)
  return (
    <PostFilterTreeContext.Provider value={{ tree, setTree }}>
      {children}
    </PostFilterTreeContext.Provider>
  )
}

export const usePostFilterTree = () => useContext(PostFilterTreeContext)

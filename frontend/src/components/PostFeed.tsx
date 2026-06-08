import React, { useEffect } from "react";
import { motion } from "motion/react";
import { List, Loader2 } from "lucide-react";
import { useScraper } from "../contexts/ScraperContext";
import { PostFilter } from "./PostFilter";
import { PostCard } from "./PostCard";

interface PostFeedProps {
  postSearch: string;
  setPostSearch: (val: string) => void;
  loadMoreRef: React.RefObject<HTMLDivElement>;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
}

export const PostFeed: React.FC<PostFeedProps> = ({
  postSearch,
  setPostSearch,
  loadMoreRef,
}) => {
  const { filteredPosts, visiblePosts, setVisiblePosts } = useScraper();

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisiblePosts((prev) => prev + 20);
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => {
      if (loadMoreRef.current) {
        observer.unobserve(loadMoreRef.current);
      }
    };
  }, [loadMoreRef, setVisiblePosts]);

  return (
    <motion.div
      key="posts"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 pb-10"
    >
      <PostFilter postSearch={postSearch} setPostSearch={setPostSearch} />

      <div className="flex items-center gap-3 mb-4 px-1">
        <div className="w-8 h-8 rounded-lg bg-app-muted flex items-center justify-center border border-app-ink/10">
          <List size={16} className="opacity-60" />
        </div>
        <div>
          <h2 className="text-xs uppercase font-bold tracking-widest leading-none">Selected Posts</h2>
          <p className="text-[10px] font-mono opacity-50 mt-1">{filteredPosts.length} Posts in Range</p>
        </div>
      </div>

      {filteredPosts.length > 0 ? (
        <div className="space-y-4">
          {filteredPosts
            .slice(0, visiblePosts)
            .map((post) => (
              <PostCard key={`${post.channelName}-${post.id}`} post={post} postSearch={postSearch} />
          ))}
          
          {/* Load More Indicator */}
          {filteredPosts.length > visiblePosts && (
            <div ref={loadMoreRef} className="h-32 flex flex-col items-center justify-center gap-4 opacity-60">
              <div className="w-10 h-10 rounded-full bg-app-card shadow-sm border border-app-ink/10 flex items-center justify-center">
                <Loader2 size={18} className="animate-spin text-app-ink/60" />
              </div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-app-ink/60">Loading more posts...</span>
            </div>
          )}
        </div>
      ) : (
        /* Empty State */
        <div className="h-full flex flex-col items-center justify-center text-center py-20 max-w-md mx-auto">
          <div className="w-16 h-16 bg-app-card shadow-sm rounded-2xl flex items-center justify-center mb-6 border border-app-ink/10">
            <List size={28} className="opacity-40" />
          </div>
          <h3 className="text-lg font-bold tracking-tight mb-2">No Posts in Range</h3>
          <p className="text-[11px] opacity-60 leading-relaxed max-w-sm">
            Try adjusting your filtration parameters, clearing your search query, or adding more channels to your selection.
          </p>
        </div>
      )}
    </motion.div>
  );
};

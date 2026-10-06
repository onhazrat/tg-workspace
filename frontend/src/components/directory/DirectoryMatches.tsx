/**
 * What a search matched in one row (DIR-04): the bio around its first match
 * and the newest matching sampled Post, under the row while "Show matches" is
 * on. The server cuts the snippets into plain runs; a hit is marked, and
 * nothing is ever read as markup.
 */
import type {
  DirectoryMatchResponse,
  DirectorySnippetPartResponse,
} from "@/client"
import { RelativeTime } from "@/components/RelativeTime"
import { telegramWebViewPostUrl } from "@/lib/telegram-web"

function Snippet({ parts }: { parts: DirectorySnippetPartResponse[] }) {
  return parts.map((p, i) =>
    p.hit ? (
      <mark key={i} className="rounded-sm bg-amber-300/40 text-inherit">
        {p.text}
      </mark>
    ) : (
      p.text
    ),
  )
}

/** A row's quotes as a table row of their own; a click opens the panel. */
export function DirectoryMatchRow({
  handle,
  match,
  colSpan,
  onOpen,
}: {
  handle: string
  match: DirectoryMatchResponse
  colSpan: number
  onOpen: (handle: string) => void
}) {
  const { bio, post } = match
  if (!bio && !post) return null
  return (
    <tr
      data-testid={`directory-match-${handle}`}
      onClick={() => onOpen(handle)}
      className="cursor-pointer hover:bg-app-ink/5"
    >
      <td colSpan={colSpan} className="px-2 pb-2 pl-12">
        {bio && (
          <p dir="auto" className="line-clamp-2 text-[11px] text-app-ink/60">
            <Snippet parts={bio} />
          </p>
        )}
        {post && (
          <blockquote
            dir="auto"
            className="mt-1 line-clamp-2 border-l-2 border-amber-400 pl-2 text-[11px] text-app-ink/80"
          >
            <Snippet parts={post.parts} />
            <a
              href={telegramWebViewPostUrl(handle, post.postId)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              data-testid={`directory-match-post-${handle}`}
              className="ml-2 font-mono text-[10px] text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              post · <RelativeTime timestamp={post.timestamp} />
            </a>
          </blockquote>
        )}
      </td>
    </tr>
  )
}

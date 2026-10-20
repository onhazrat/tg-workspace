import { redirect } from "@tanstack/react-router"

/**
 * An old Settings address lands on the Settings tab with its query string kept
 * (story 72). An old `?section=` or a `?setting=` it already carries says where;
 * otherwise the page opens on `setting`.
 */
export function redirectToSettings(searchStr: string, setting: string): never {
  const params = new URLSearchParams(searchStr)
  params.set("tab", "settings")
  if (!params.has("setting") && !params.has("section"))
    params.set("setting", setting)
  throw redirect({ href: `/?${params}`, replace: true })
}

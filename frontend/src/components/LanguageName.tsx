import { languageLabel, languageValue } from "@/lib/language-name"

/**
 * A stored Language as every Language menu shows it: the name, then the value
 * a filter names it by, dimmed ("Persian fa", "Not read yet null"). For the
 * places outside the menus; a menu row passes the same two strings as its
 * label and hint.
 */
export function LanguageName({ code }: { code: string | null | undefined }) {
  const value = languageValue(code)
  return (
    <>
      {languageLabel(value)}{" "}
      {/* Relative, not a fixed ink: the cells and badges this sits in are
          already dimmed, and a fixed color reads the same as their text. */}
      <span className="font-normal opacity-60">{value}</span>
    </>
  )
}

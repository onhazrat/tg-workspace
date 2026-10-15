/**
 * A Language code as the server stores it (`fa`, `ckb`), named in the reader's
 * locale: "Persian" for an English interface. The server keeps codes and no
 * name table (ADR-021), so this is the only place a name is made.
 *
 * `locale` is for tests; production passes nothing and gets the browser's.
 */
export function languageName(code: string, locale?: string): string {
  try {
    return new Intl.DisplayNames(locale, { type: "language" }).of(code) ?? code
  } catch {
    // Not a well-formed tag, so there is nothing better to show than itself.
    return code
  }
}

/**
 * The Language Condition value for a row not read yet, whose stored Language is
 * `null` (ADR-021, revised). The server answers the same string. It is also the
 * hint the menus show, so what a user sees is what the filter text says.
 */
export const NOT_READ = "null"

/** The values that are not Languages, in the order every menu ends with them. */
const NOT_LANGUAGES = ["und", "zxx", NOT_READ]

/** A stored Language as the value a Condition names: the code, or `null`. */
export function languageValue(code: string | null | undefined): string {
  return code ?? NOT_READ
}

/** A Condition value as a person reads it: "Persian", "No words". */
export function languageLabel(value: string, locale?: string): string {
  if (value === "zxx") return "No words"
  if (value === "und") return "Undetermined"
  if (value === NOT_READ) return "Not read yet"
  return languageName(value, locale)
}

/**
 * The one order every Language menu shows: Languages by count, most first,
 * ties and uncounted ones by name; then Undetermined, No words and Not read
 * yet, in that order whatever their counts.
 */
export function sortLanguages<T extends { value: string; count?: number }>(
  options: T[],
  locale?: string,
): T[] {
  const keyed = options.map((option) => ({
    option,
    rank: NOT_LANGUAGES.indexOf(option.value),
    label: languageLabel(option.value, locale),
  }))
  return keyed
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (b.option.count ?? 0) - (a.option.count ?? 0) ||
        a.label.localeCompare(b.label, locale),
    )
    .map(({ option }) => option)
}

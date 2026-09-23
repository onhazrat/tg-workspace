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

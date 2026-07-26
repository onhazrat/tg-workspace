/**
 * Mask credentials in proxy URLs before showing them in the UI.
 *
 * Mirrors `redact_proxy_url` in `backend/app/services/network_settings.py`, which
 * already does this for proxy URLs written to network logs. The two must agree:
 * a proxy shown in Network Telemetry and the same proxy shown in the settings
 * editor should read identically.
 *
 * Implemented as string surgery on the userinfo rather than via `URL`, because
 * `URL` normalizes what it round-trips (`http://u:p@host:8080` comes back with a
 * trailing slash). Anything that is not a credentialed URL — a bare host, the
 * literal `"direct"`, an empty line, a half-typed URL — is returned untouched.
 */

/**
 * `scheme://userinfo@rest`. The userinfo run excludes `/?#` so a credential-free
 * URL whose *path* contains `@` is not mistaken for one that has credentials.
 * The run is greedy so a password containing `@` splits at the last `@`, which is
 * how a URL parser resolves that ambiguity.
 */
const CREDENTIALED_URL = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)@(.*)$/i

/**
 * Replace a proxy URL's credentials with `***`, leaving everything else as-is.
 *
 * Surrounding whitespace is stripped before matching — otherwise an indented line
 * would fail `^` and leak — then restored, so masking a list never reflows it.
 */
export function maskProxyUrl(proxyUrl: string): string {
  const leading = proxyUrl.length - proxyUrl.trimStart().length
  const trailing = proxyUrl.length - proxyUrl.trimEnd().length
  const match = CREDENTIALED_URL.exec(proxyUrl.trim())
  if (!match) return proxyUrl
  const [, scheme, , hostAndBeyond] = match
  return (
    proxyUrl.slice(0, leading) +
    `${scheme}***@${hostAndBeyond}` +
    proxyUrl.slice(proxyUrl.length - trailing)
  )
}

/**
 * Mask every URL in a newline-separated proxy list, preserving line structure so
 * the masked text lines up with the textarea the user edits.
 */
export function maskProxyList(proxyUrls: string): string {
  return proxyUrls
    .split("\n")
    .map((line) => maskProxyUrl(line))
    .join("\n")
}

/** Whether any line in the list carries credentials worth hiding. */
export function hasProxyCredentials(proxyUrls: string): boolean {
  return proxyUrls
    .split("\n")
    .some((line) => CREDENTIALED_URL.test(line.trim()))
}

// #1328 (audit F09): an address the server cannot open as an app (a mistyped
// root, an app that is off or missing) is sent to one page, which says so in
// the shared ProblemPage. The address it was asked for travels as text only.

/** The page that says nothing is available at an address. */
export const UNAVAILABLE_PATH = '/featherbase/unavailable'

/** The longest address the page repeats; a longer one reads as "the address you asked for". */
export const ADDRESS_MAX = 200

/**
 * The address as the page may repeat it: a relative path starting with a single
 * "/", with no backslash or control character, at most ADDRESS_MAX long. It is
 * only ever shown as text, never followed or used as a link. Anything else is null.
 */
export function askedAddress(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > ADDRESS_MAX) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null
  return raw
}

/** Where the server sends a navigation it cannot serve. */
export function unavailableHref(path: string): string {
  return `${UNAVAILABLE_PATH}?address=${encodeURIComponent(path)}`
}

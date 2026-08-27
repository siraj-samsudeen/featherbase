// A click-through sign-in link for a dev-preview deployment: one URL that
// lands the owner inside the app as an ordinary named user, so a feature can
// be judged the way someone using it would see it rather than as the
// Administrator break-glass account.
//
// This is an authentication bypass, so it is built to be inert unless
// deliberately switched on, and impossible to switch on weakly:
//
//   - **Off unless BOTH variables are set.** No variable, no route: the
//     handler answers 404 rather than an error, so an instance that does not
//     run previews does not advertise that the path exists at all.
//   - **The key must be long.** A short one would be guessable at HTTP speed
//     against a route that hands out sessions. A too-short key does not
//     "degrade" to working — it refuses, loudly, at boot.
//   - **Never Administrator.** The one account the deployment guide (#130)
//     treats as break-glass is exactly the account a shared link must not
//     hand out, and it is also not what a preview is for.
//   - **Compared in constant time**, like every other credential here.
//
// What it is NOT: a way to skip sign-in generally, and not a role grant. The
// named user's own roles decide what the visitor can do, so the preview shows
// the real permission surface rather than a privileged illusion of it.
import { timingSafeEqual } from 'node:crypto'

// 32 characters of base64url is ~192 bits. The point is not the exact number
// but that a human-chosen word cannot reach it.
export const PREVIEW_KEY_MIN_LENGTH = 32

export interface PreviewLogin {
  key: string
  user: string
}

// Reasons a configured preview is refused, so boot can say which one.
export type PreviewRefusal =
  | 'incomplete'
  | 'key-too-short'
  | 'administrator'

let announced = false

/**
 * The active preview configuration, or null when previews are off.
 *
 * Read per call rather than cached at import: tests set and clear the
 * variables around individual cases, and a cached read would leak one case's
 * configuration into the next.
 */
export function previewLogin(): PreviewLogin | null {
  return resolvePreviewLogin().login
}

export function resolvePreviewLogin(): {
  login: PreviewLogin | null
  refusal: PreviewRefusal | null
} {
  const key = (process.env.PREVIEW_LOGIN_KEY ?? '').trim()
  const user = (process.env.PREVIEW_LOGIN_USER ?? '').trim()

  // Neither set: previews are simply not in use here. Not a refusal.
  if (!key && !user) return { login: null, refusal: null }
  // One set without the other is a misconfiguration, not a preference — say
  // so rather than silently doing nothing.
  if (!key || !user) return { login: null, refusal: 'incomplete' }
  if (key.length < PREVIEW_KEY_MIN_LENGTH) return { login: null, refusal: 'key-too-short' }
  if (user === 'Administrator') return { login: null, refusal: 'administrator' }
  return { login: { key, user }, refusal: null }
}

const REFUSAL_REASON: Record<PreviewRefusal, string> = {
  incomplete: 'PREVIEW_LOGIN_KEY and PREVIEW_LOGIN_USER must both be set',
  'key-too-short': `PREVIEW_LOGIN_KEY must be at least ${PREVIEW_KEY_MIN_LENGTH} characters`,
  administrator: 'PREVIEW_LOGIN_USER must not be Administrator',
}

/**
 * Say once, at boot, whether preview sign-in is live — an auth bypass that
 * nobody noticed being enabled is the failure mode worth spending a log line
 * on. A refusal is a warning, because someone set the variables expecting it
 * to work.
 */
export function announcePreviewLogin(log: (message: string) => void = console.log): void {
  if (announced) return
  announced = true
  const { login, refusal } = resolvePreviewLogin()
  if (refusal) log(`preview sign-in REFUSED: ${REFUSAL_REASON[refusal]}`)
  else if (login) log(`preview sign-in enabled at /preview as ${login.user}`)
}

/** Constant-time key comparison; a length mismatch is a mismatch. */
export function previewKeyMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

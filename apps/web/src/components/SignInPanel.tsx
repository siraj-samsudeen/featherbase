// #1283: the one panel of ways in, drawn the same everywhere a sign-in is offered: under the
// first page's form, and on the "We couldn't sign you in" card. Same methods, same order, same
// button. A page leaves out only the way in whose form it already shows.
import { buttonClasses } from '@featherbase/shop-floor'

export interface SignInMethod {
  key: string
  label: string
}

export const GOOGLE_LOGIN_HREF = '/api/oauth/google/login'
/** A failed Google sign-in tries again with Google's account picker. */
export const GOOGLE_RETRY_HREF = '/api/oauth/google/login?prompt=select_account'
export const MICROSOFT_LOGIN_HREF = '/api/oauth/microsoft/login'
export const PASSWORD_LABEL = 'Sign in with user name and password'

const BUTTON = buttonClasses({ className: 'flex w-full justify-center py-2' })

export function SignInPanel({
  google,
  microsoft,
  delegated,
  password,
  failed = null,
  without = null,
  onRedirect,
  onDelegated,
  onPassword,
}: {
  google?: SignInMethod | null
  microsoft?: SignInMethod | null
  /** Each connected service (a delegated_password method, such as StyleHR). */
  delegated: SignInMethod[]
  /** Whether user name and password is switched on. */
  password: boolean
  /** The redirect sign-in that just failed: it keeps its place, as "Try another … account". */
  failed?: 'google' | 'microsoft' | null
  /** The way in whose form the page already shows: 'password', or a connected service's key. */
  without?: string | null
  /** Before leaving for Google or Microsoft (the page remembers where to return). */
  onRedirect?: () => void
  onDelegated: (key: string) => void
  onPassword: () => void
}) {
  const redirect = (kind: 'google' | 'microsoft', method: SignInMethod) => {
    const retry = failed === kind
    return (
      <a
        key={kind}
        href={kind === 'google' ? (retry ? GOOGLE_RETRY_HREF : GOOGLE_LOGIN_HREF) : MICROSOFT_LOGIN_HREF}
        onClick={onRedirect}
        data-testid={retry ? `refused-${kind}-retry` : `${kind}-login`}
        className={BUTTON}
      >
        {retry ? `Try another ${method.label} account` : `Sign in with ${method.label}`}
      </a>
    )
  }
  const services = delegated.filter((m) => m.key !== without)
  return (
    <div className="flex flex-col gap-3" data-testid="sign-in-panel">
      {google && redirect('google', google)}
      {microsoft && redirect('microsoft', microsoft)}
      {services.map((m) => (
        <button
          key={m.key}
          type="button"
          data-testid={delegated.length === 1 ? 'delegated-login-toggle' : `delegated-login-toggle-${m.key}`}
          className={BUTTON}
          onClick={() => onDelegated(m.key)}
        >
          Sign in with {m.label}
        </button>
      ))}
      {/* #1258: a full button like the other ways in, last. */}
      {password && without !== 'password' && (
        <button type="button" data-testid="password-login-toggle" className={BUTTON} onClick={onPassword}>
          {PASSWORD_LABEL}
        </button>
      )}
    </div>
  )
}

/** Whether the panel would draw any button at all, for the "or" divider above it. */
export function hasOtherWays(p: { google?: unknown; microsoft?: unknown; delegated: SignInMethod[]; password: boolean; without?: string | null }): boolean {
  return Boolean(p.google || p.microsoft || p.delegated.some((m) => m.key !== p.without) || (p.password && p.without !== 'password'))
}

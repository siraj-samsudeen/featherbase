import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button, cardClasses } from '@featherbase/shop-floor'
import { api, getToken, loginHref } from '../lib/api'
import { Logo } from '../components/Logo'
import { usePageTitle } from '../lib/page-title'
import { browserNavigation } from '../lib/browser-navigation'

// mcp-oauth-connect (#1207, items 4-7): the authorization page an agent opens
// in the person's browser. The server checks the agent's request and says what
// is asking; the person allows or denies, and the browser goes back to the
// agent's own address with the answer. A request the server refuses is shown
// here and never sent anywhere.

interface ConnectRequest {
  client_name: string
  /** 'loopback' (a program on this computer) or the https origin it returns to. */
  return_place: string
  person: string
  remembered: boolean
}

/** Where an agent returns to, in words: a program on this computer, or its https origin. */
export const returnPlaceText = (place: string) => (place === 'loopback' ? 'your computer' : place)

export function AgentConnectPage() {
  const router = useRouter()
  // The agent's query exactly as it arrived: the server checks it, and the
  // answer must carry the agent's own values back unchanged.
  const query = router.history.location.search
  const signedIn = Boolean(getToken())
  // Signed out: the usual sign-in, coming back here with the query unchanged.
  useEffect(() => {
    if (!signedIn) router.history.replace(loginHref(`/featherbase/connect${query}`))
  }, [signedIn, router, query])
  return signedIn ? <AgentConnect query={query} /> : null
}

function AgentConnect({ query }: { query: string }) {
  usePageTitle('Connect an agent')
  const request = useQuery({
    queryKey: ['agent-auth', 'request', query],
    queryFn: () => api.get<ConnectRequest>(`/api/agent-auth/request${query}`),
    retry: false,
  })
  const [sent, setSent] = useState(false)
  const decide = useMutation({
    mutationFn: (allow: boolean) => api.post<{ redirect: string }>(`/api/agent-auth/decision${query}`, { allow }),
    onSuccess: ({ redirect }) => {
      browserNavigation.leaveFor(redirect)
      setSent(true)
    },
  })
  // An Allow already given to this agent goes straight back, once.
  const decided = useRef(false)
  const remembered = request.data?.remembered === true
  useEffect(() => {
    if (!remembered || decided.current) return
    decided.current = true
    decide.mutate(true)
  }, [remembered, decide])

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4" data-testid="agent-connect">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo className="h-11 w-11 rounded-xl shadow-sm" />
        </div>
        <div className={cardClasses('p-6')}>
          {request.error ? (
            <div className="space-y-2" data-testid="connect-error">
              <h1 className="text-base font-semibold text-ink">This connection request can't be used</h1>
              <p className="text-sm text-negative">{request.error.message}</p>
            </div>
          ) : sent ? (
            <p className="text-sm text-ink" data-testid="connect-sent">You can close this window.</p>
          ) : !request.data ? (
            <p className="text-sm text-ink-muted">Loading…</p>
          ) : remembered ? (
            <p className="text-sm text-ink" data-testid="connect-remembered">Connecting “{request.data.client_name}”…</p>
          ) : (
            <div className="space-y-4" data-testid="connect-consent">
              <div className="space-y-1">
                <h1 className="text-base font-semibold text-ink">“{request.data.client_name}” wants to connect</h1>
                <p className="text-xs text-ink-subtle">The name is how the app describes itself.</p>
              </div>
              <ul className="space-y-1 text-sm text-ink">
                <li>It will return to {returnPlaceText(request.data.return_place)}</li>
                <li>Signed in as {request.data.person}</li>
              </ul>
              <p className="text-sm text-ink">It will act as you, with your roles and permissions, until you disconnect it.</p>
              {decide.error && <p className="text-sm text-negative" data-testid="connect-decision-error">{decide.error.message}</p>}
              <div className="flex justify-end gap-2">
                <Button disabled={decide.isPending} onClick={() => decide.mutate(false)}>Deny</Button>
                <Button variant="primary" disabled={decide.isPending} onClick={() => decide.mutate(true)}>Allow</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

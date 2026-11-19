import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { askedAddress } from 'shared'
import { Card, ProblemPage, Skeleton, buttonClasses } from '@featherbase/shop-floor'
import { api, getToken } from '../lib/api'
import { usePageTitle } from '../lib/page-title'
import { useShellKind } from '../lib/session'
import { TopBar } from '../components/TopBar'
import { ThemeChoiceProvider } from '../lib/theme-choice'

const TITLE = 'Not Available'

/**
 * #1328 (audit F09): what an address the server cannot open as an app shows (a mistyped root, an app that
 * is off or missing), under the shared top bar, in the person's theme. The address is repeated as text
 * only. That an app is turned off is the server's answer, given only to someone who could use it; anyone
 * else, and anyone signed out, reads that nothing is available there.
 */
export function UnavailablePage({ address }: { address: unknown }) {
  const shown = askedAddress(address)
  const signedIn = Boolean(getToken())
  const status = useQuery({
    queryKey: ['address_status', shown],
    queryFn: () => api.get<{ turned_off: { title: string } | null }>(`/api/address_status?address=${encodeURIComponent(shown!)}`),
    enabled: signedIn && shown !== null,
    retry: false,
  })
  usePageTitle(TITLE)
  // Signed out, there is no top bar to write the tab.
  useEffect(() => { if (!signedIn) document.title = `${TITLE} · Featherbase` }, [signedIn])
  return (
    <ThemeChoiceProvider>
      <div className="flex min-h-screen flex-col bg-canvas">
        {signedIn && <TopBar forPerson />}
        <main className="flex flex-1 items-center justify-center p-4">
          <Card className="w-full max-w-sm">
            {signedIn && shown !== null && status.isPending
              ? <Skeleton label="Checking the address" className="w-full" />
              : <Answer shown={shown} off={status.data?.turned_off ?? null} signedIn={signedIn} />}
          </Card>
        </main>
      </div>
    </ThemeChoiceProvider>
  )
}

function Answer({ shown, off, signedIn }: { shown: string | null; off: { title: string } | null; signedIn: boolean }) {
  const action = <WayForward signedIn={signedIn} />
  if (off)
    return <ProblemPage kind="not-found" title={`${off.title} is turned off`} body="Ask your system manager to turn it on again." action={action} />
  return (
    <ProblemPage
      kind="not-found"
      title={`Nothing is available at ${shown ?? 'the address you asked for'}`}
      body="Check the address for a typo."
      action={action}
    />
  )
}

/** One way forward: Featherbase for an administrator or someone signed out; their apps for someone whose place is an app. */
function WayForward({ signedIn }: { signedIn: boolean }) {
  const kind = useShellKind()
  const words = signedIn && kind !== 'admin' && kind !== 'loading' && kind !== 'failed' ? 'Open your apps' : 'Go to Featherbase'
  return <a href="/" className={buttonClasses()}>{words}</a>
}

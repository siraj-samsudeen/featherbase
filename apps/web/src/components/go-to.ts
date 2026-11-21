import { useRouter } from '@tanstack/react-router'
import { api } from '../lib/api'
import { useOnAppAddress } from './TopBar'

const ADMIN_PATH = /^\/featherbase\/admin(?:[/?#]|$)/

/** #1385: the platform's one way to open an address from its shared chrome (the command bar, the
 *  sidebar's defaults). It goes through the page's router: the Admin's moves within the Admin; an
 *  app page's bar router loads each address in full (bar/mount.tsx). On an app's own address the
 *  Admin is another address: an Admin destination opens there through the sign-in hand-off, which
 *  carries the page chosen (Open Admin's route). */
export function useGoTo(): (href: string) => void {
  const router = useRouter()
  const onAppAddress = useOnAppAddress()
  return (href: string) => {
    if (!onAppAddress || !ADMIN_PATH.test(href)) return router.history.push(href)
    void api.post<{ handoff?: string; landing?: string }>('/api/open_admin', { next: href }).then(
      (to) => (to.handoff ? window.location.assign(to.handoff) : router.history.push(to.landing ?? href)),
      () => router.history.push(href),
    )
  }
}

import { useEffect } from 'react'
import { PathBar, RecentPaths } from '@featherbase/shop-floor'
import { encodePath, type NavPath } from '../lib/nav-path'
import { usePageNavigation } from '../lib/navigation'
import { useNavigationSettings } from '../lib/nav-settings'
import { useStepLabels } from '../lib/step-labels'

// #910 checklist 11–14: the path bar of a list or row page. Its steps are
// named per viewer; Back, Forward and each step move along the path (each a
// browser history entry); Copy link copies this step's address; Recent paths
// offers the person's last ten walks, remembered in their settings.

export function NavPathBar() {
  // Drawn only by the list and row pages, inside their walk's provider.
  const nav = usePageNavigation()!
  const settings = useNavigationSettings()
  const path = nav.path
  const key = encodePath(path)
  const labels = useStepLabels(path.steps)
  // Every walk the person takes is remembered as they go.
  useEffect(() => {
    if (settings.ready) settings.remember(path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, settings.ready])
  // #1013: one step is no path, and would only repeat the page's own heading.
  // Only the way back to remembered walks stays, so they survive signing in.
  if (path.steps.length < 2) {
    if (settings.recent.length === 0) return null
    return (
      <div className="mb-3 flex justify-end">
        <RecentWalks paths={settings.recent} onPick={nav.open} />
      </div>
    )
  }
  return (
    <div className="mb-3">
      <PathBar
        steps={path.steps.map((_, i) => ({ key: String(i), label: labels[i] }))}
        current={path.at}
        onStep={nav.go}
        onBack={() => nav.go(path.at - 1)}
        onForward={() => nav.go(path.at + 1)}
        onCopyLink={() => void navigator.clipboard?.writeText(new URL(nav.href(path), window.location.origin).href).catch(() => {})}
        recent={<RecentWalks paths={settings.recent} onPick={nav.open} />}
      />
    </div>
  )
}

function RecentWalks({ paths, onPick }: { paths: NavPath[]; onPick: (path: NavPath) => void }) {
  const walks = paths.map((p) => p.steps.slice(0, p.at + 1))
  const labels = useStepLabels(walks.flat())
  let offset = 0
  const items = walks.map((steps, i) => {
    const label = labels.slice(offset, offset + steps.length).join(' › ')
    offset += steps.length
    return { key: String(i), label }
  })
  return <RecentPaths paths={items} onPick={(k) => onPick(paths[Number(k)])} />
}

import { useEffect } from 'react'
import { PathBar, RecentPaths } from '@featherbase/shop-floor'
import { back, encodePath, forward, type NavPath } from '../lib/nav-path'
import { useNavigation } from '../lib/navigation'
import { useNavigationSettings } from '../lib/nav-settings'
import { useStepLabels } from '../lib/step-labels'

// #910 checklist 11–14: the path bar of a list or row page. Its steps are
// named per viewer; Back, Forward and each step move along the path (each a
// browser history entry); Copy link copies this step's address; Recent paths
// offers the person's last ten walks, remembered in their settings.

export function NavPathBar() {
  const nav = useNavigation()
  const settings = useNavigationSettings()
  const path = nav?.path
  const key = path ? encodePath(path) : ''
  const labels = useStepLabels(path?.steps ?? [])
  // Every walk the person takes is remembered as they go.
  useEffect(() => {
    if (path && nav?.addressed && settings.ready) settings.remember(path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, settings.ready])
  if (!nav || !path) return null
  return (
    <PathBar
      steps={path.steps.map((_, i) => ({ key: String(i), label: labels[i] }))}
      current={path.at}
      onStep={nav.go}
      onBack={() => nav.open(back(path))}
      onForward={() => nav.open(forward(path))}
      onCopyLink={() => void navigator.clipboard?.writeText(new URL(nav.href(path), window.location.origin).href).catch(() => {})}
      recent={<RecentWalks paths={settings.recent} onPick={nav.open} />}
    />
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

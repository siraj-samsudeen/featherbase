import { useEffect } from 'react'
import { PathBar, RecentPaths } from '@featherbase/shop-floor'
import { encodePath, type NavPath } from '../lib/nav-path'
import { usePageNavigation } from '../lib/navigation'
import { useNavigationSettings } from '../lib/nav-settings'
import { useCompactWalkLabels, useStepLabels } from '../lib/step-labels'
import { SidewaysMenu, WalkControl, useWalk, useWalkKeys } from './SidewaysMenu'

// #910 checklist 11–14: the path bar of a list or row page. Its steps are
// named per viewer; Back, Forward and each step move along the path (each a
// browser history entry); Copy link copies this step's address; Recent paths
// offers the person's last ten walks, remembered in their settings (and in the
// sidebar's Recently Opened, #1288).

export function NavPathBar() {
  // Drawn only by the list and row pages, inside their walk's provider.
  const nav = usePageNavigation()!
  const settings = useNavigationSettings()
  const path = nav.path
  const key = encodePath(path)
  const labels = useStepLabels(path.steps)
  // #1343 W1–W4, #1349 item 4: the walk through the last step's list or group, and ↑/↓ for it, even where one
  // step draws no bar (a row peeked over a list).
  const walk = useWalk(path)
  const last = path.at === path.steps.length - 1
  useWalkKeys(last ? walk : null, nav)
  // Every walk the person takes is remembered as they go.
  useEffect(() => {
    if (settings.ready) settings.remember(path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, settings.ready])
  // #1013: one step is no path, and would only repeat the page's own heading.
  // #1288: remembered walks are reopened from the sidebar's Recently Opened, so nothing shows here.
  if (path.steps.length < 2) return null
  return (
    <div className="mb-3">
      <PathBar
        steps={path.steps.map((_, i) => ({ key: String(i), label: labels[i] }))}
        current={path.at}
        onStep={nav.go}
        onBack={() => nav.go(path.at - 1)}
        onForward={() => nav.go(path.at + 1)}
        onCopyLink={() => navigator.clipboard.writeText(new URL(nav.href(path), window.location.origin).href)}
        recent={<RecentWalks paths={settings.recent} onPick={nav.open} />}
        // #1282 I1: the other rows of the list the last step came from, on the last step only.
        // #1343 W1: then "‹ 3 of 12 ›" to walk them.
        besideCurrent={last ? <><SidewaysMenu nav={nav} /><WalkControl walk={walk} nav={nav} /></> : undefined}
      />
    </div>
  )
}

/** #1288: the walks' short names for the sidebar's Recently Opened: "Bayside › Section Subcategory". */
export function useSidebarWalkLabels(paths: NavPath[]): string[] {
  return useCompactWalkLabels(paths.map((p) => p.steps.slice(0, p.at + 1)))
}

/** The walks' names, step by step, as the path bar names them: "Category › Sarees › Rows". */
function useWalkLabels(paths: NavPath[]): string[] {
  const walks = paths.map((p) => p.steps.slice(0, p.at + 1))
  const labels = useStepLabels(walks.flat())
  let offset = 0
  return walks.map((steps) => {
    const label = labels.slice(offset, offset + steps.length).join(' › ')
    offset += steps.length
    return label
  })
}

function RecentWalks({ paths, onPick }: { paths: NavPath[]; onPick: (path: NavPath) => void }) {
  const items = useWalkLabels(paths).map((label, i) => ({ key: String(i), label }))
  return <RecentPaths paths={items} onPick={(k) => onPick(paths[Number(k)])} />
}

import { createRoot } from 'react-dom/client'
import { APP_THEME_ATTRIBUTE, THEME_CHANGE_EVENT, paintTheme } from '@featherbase/shop-floor/theme'
import { listAll, listCopy, refusedAccess } from './api'
import { datasetFrom, setCopiesOnly, setDataset, type ReachRow, type RunLineRow } from './dataset'
import { hostedStart } from './startup'
import './style.css'

// The page takes the theme the person chose in the shared top bar; before it paints, the device's.
const painted = document.documentElement.getAttribute(APP_THEME_ATTRIBUTE)
paintTheme(painted === 'light' || painted === 'dark' ? painted : 'device')
window.addEventListener(THEME_CHANGE_EVENT, event => {
  const theme = (event as CustomEvent<{ theme?: unknown }>).detail?.theme
  if (theme === 'light' || theme === 'dark') paintTheme(theme)
})

const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.localhost')
const NoRun = () => (
  <div style={{ padding: 32, font: '15px system-ui', maxWidth: 560 }}>
    <h1 style={{ fontSize: 20 }}>No Run is loaded yet</h1>
    <p>The forecast team loads each month's engine Run and who reviews it; the month opens here once it is loaded.</p>
  </div>)
const NoAccess = () => (
  <div style={{ padding: 32, font: '15px system-ui', maxWidth: 560 }}>
    <h1 style={{ fontSize: 20 }}>You don't have access to forecasting data</h1>
    <p>Forecasting opens for the stores, sections and subcategories the org chart gives you, as Dash does. If your job on
      the org chart is missing or wrong, ask your Store Manager or HR to correct it.</p>
  </div>)

// The Run under review and who reviews it are read first; the app's modules build from them as they load.
const root = createRoot(document.getElementById('root')!)
async function start() {
  root.render(<p style={{ padding: 24, font: '14px system-ui', color: '#5b6575' }}>Opening the month under review…</p>)
  try {
    const [lines, reach] = await Promise.all([
      listAll<RunLineRow>('forecasting.run_line', ['run', 'month', 'store', 'region', 'division', 'subdivision', 'category', 'section', 'subcategory', 'code', 'forecast', 'aop', 'band', 'days_json', 'parts_json', 'other', 'qty', 'aop_qty']),
      listAll<ReachRow>('forecasting.reach', ['full_name', 'code', 'role', 'place', 'reports_to', 'places_json'])])
    const dataset = datasetFrom(lines, reach)
    // The made-up data is for a local instance only: a hosted one with no Run loaded says so instead.
    if (!dataset && !LOCAL) {
      // a hosted instance on the read-only copies (#1418): open the pages built on them once an official Run is loaded
      // through the scoped read (#1454), so the same rule that filters the rows decides who opens the app
      const how = await hostedStart(() => listCopy<{ run_id: string }>('forecasting.forecast_run', ['run_id'], []))
      if (how === 'no-access') { root.render(<NoAccess />); return }
      if (how === 'no-run') { root.render(<NoRun />); return }
      setCopiesOnly(true)
    }
    setDataset(dataset)
  } catch (e) {
    if ((e as { status?: number }).status === 401) { window.location.href = `/featherbase/login?next=${encodeURIComponent(location.pathname + location.search)}`; return }
    // a hosted instance never falls back to the made-up data for someone it refuses (#1454)
    if (!LOCAL && refusedAccess(e)) { root.render(<NoAccess />); return }
    setDataset(null) // an older instance without the Tables: the made-up data
  }
  const { ForecastingApp } = await import('./App')
  root.render(<ForecastingApp />)
}
void start()

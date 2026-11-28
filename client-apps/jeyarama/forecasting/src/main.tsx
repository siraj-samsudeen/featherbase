import { createRoot } from 'react-dom/client'
import { APP_THEME_ATTRIBUTE, THEME_CHANGE_EVENT, paintTheme } from '@featherbase/shop-floor/theme'
import { listCopy, readOp } from './api'
import { hostedStart, startFailure } from './startup'
import './style.css'

// The page takes the theme the person chose in the shared top bar; before it paints, the device's.
const painted = document.documentElement.getAttribute(APP_THEME_ATTRIBUTE)
paintTheme(painted === 'light' || painted === 'dark' ? painted : 'device')
window.addEventListener(THEME_CHANGE_EVENT, event => {
  const theme = (event as CustomEvent<{ theme?: unknown }>).detail?.theme
  if (theme === 'light' || theme === 'dark') paintTheme(theme)
})

const NoRun = () => (
  <div style={{ padding: 32, font: '15px system-ui', maxWidth: 560 }}>
    <h1 style={{ fontSize: 20 }}>No Run is loaded yet</h1>
    <p>The forecast team loads each month's engine Run and who reviews it; the month opens here once it is loaded.</p>
  </div>)
const TryAgain = () => (
  <div style={{ padding: 32, font: '15px system-ui', maxWidth: 560 }}>
    <h1 style={{ fontSize: 20 }}>This page couldn't load</h1>
    <p>Check your connection and try again.</p>
    <button type="button" onClick={() => window.location.reload()}>Try again</button>
  </div>)
const NoAccess = () => (
  <div style={{ padding: 32, font: '15px system-ui', maxWidth: 560 }}>
    <h1 style={{ fontSize: 20 }}>You don't have access to forecasting data</h1>
    <p>Forecasting opens for the stores, sections and subcategories the org chart gives you, as Dash does. If your job on
      the org chart is missing or wrong, ask your Store Manager or HR to correct it.</p>
  </div>)

// Someone the org chart gives no place has no access (#1454); everyone else opens on the Runs loaded
const root = createRoot(document.getElementById('root')!)
async function start() {
  root.render(<p style={{ padding: 24, font: '14px system-ui', color: '#5b6575' }}>Opening the month under review…</p>)
  try {
    const how = await hostedStart(async () => { await readOp('my_places'); return listCopy<{ run_id: string }>('forecasting.forecast_run', ['run_id'], []) })
    if (how === 'no-access') { root.render(<NoAccess />); return }
    if (how === 'no-run') { root.render(<NoRun />); return }
  } catch (e) {
    // never the made-up data (#1454): a lapsed sign-in signs in again, a refusal is no access, anything else a retry
    const failed = startFailure(e, false)
    if (failed === 'sign-in') { window.location.href = `/featherbase/login?next=${encodeURIComponent(location.pathname + location.search)}`; return }
    if (failed === 'no-access') { root.render(<NoAccess />); return }
    root.render(<TryAgain />); return
  }
  const { ForecastingApp } = await import('./App')
  root.render(<ForecastingApp />)
}
void start()

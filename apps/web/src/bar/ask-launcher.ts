// Ask on every page (prototype): where the Ask app is installed and this person may open it, a
// button at the bottom right opens Ask in a panel beside the page. On a Dash report the panel is
// told which report and store are on show, so a question starts from there. The panel is Ask's own
// page in a frame (same origin): its answers, limits and log are exactly the Ask app's.
const ASK = '/ask/'
const STYLE = `
.fb-ask-button { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px;
  border: 0; border-radius: 999px; background: var(--color-action, #1d4ed8); color: var(--color-action-ink, #fff); font: 600 14px/1 var(--font-sans, system-ui); cursor: pointer;
  box-shadow: 0 6px 20px rgb(15 23 42 / .22); }
.fb-ask-button:hover { background: var(--color-action-hover, #1e40af); }
.fb-ask-button:focus-visible, .fb-ask-close:focus-visible { outline: 2px solid var(--color-focus, #1d4ed8); outline-offset: 2px; }
.fb-ask-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483001; width: min(460px, 100vw); display: flex; flex-direction: column;
  background: var(--color-surface, #fff); box-shadow: -12px 0 32px rgb(15 23 42 / .18); }
.fb-ask-drawer[hidden] { display: none; }
.fb-ask-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 8px 0 16px; font: 13px/1 var(--font-sans, system-ui); }
.fb-ask-head a { color: var(--color-action, #1d4ed8); text-decoration: none; }
.fb-ask-head a:hover { text-decoration: underline; }
.fb-ask-close { border: 0; border-radius: 8px; background: transparent; color: var(--color-ink-muted, #5b6472); width: 32px; height: 32px; font-size: 18px; cursor: pointer; }
.fb-ask-close:hover { background: var(--color-subtle, #f1f2f4); }
.fb-ask-drawer iframe { flex: 1; width: 100%; border: 0; }
`

/** The report and store the page shows, when it is a Dash report: what the panel starts from. */
export function askFocus(location: Pick<Location, 'pathname' | 'search'>): string {
  const out = new URLSearchParams({ panel: '1' })
  if (location.pathname.startsWith('/dash/')) {
    const here = new URLSearchParams(location.search)
    if (!here.get('view')) out.set('report', here.get('report') ?? 'sales')
    if (here.get('store')) out.set('store', here.get('store')!)
  }
  return `${ASK}?${out}`
}

export function installAskLauncher(window: Window, document: Document) {
  // Never inside Ask itself, the panel's own frame, or a page shown before sign-in.
  if (window.top !== window || window.location.pathname.startsWith(ASK) || /\/(login|privacy)\b/.test(window.location.pathname)) return
  if (document.querySelector('.fb-ask-button')) return
  void fetch('/api/app_catalog', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : [])).then((apps: { name: string }[]) => {
    if (!Array.isArray(apps) || !apps.some(app => app.name === 'ask') || document.querySelector('.fb-ask-button')) return
    const style = document.createElement('style')
    style.textContent = STYLE
    const button = document.createElement('button')
    button.type = 'button'; button.className = 'fb-ask-button'; button.textContent = 'Ask'
    button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false'); button.title = 'Ask a question about this page, or anything else'
    const drawer = document.createElement('aside')
    drawer.className = 'fb-ask-drawer'; drawer.hidden = true; drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-label', 'Ask')
    const head = document.createElement('div'); head.className = 'fb-ask-head'
    const all = document.createElement('a'); all.href = `${ASK}?view=mine`; all.textContent = 'All My Questions'
    const close = document.createElement('button'); close.type = 'button'; close.className = 'fb-ask-close'; close.setAttribute('aria-label', 'Close Ask'); close.textContent = '×'
    head.append(all, close)
    const frame = document.createElement('iframe'); frame.title = 'Ask'
    drawer.append(head, frame)
    const show = (open: boolean) => {
      // Opened fresh each time, so it starts from the report and store on show now.
      if (open) frame.src = askFocus(window.location)
      drawer.hidden = !open; button.hidden = open; button.setAttribute('aria-expanded', String(open))
      if (!open) button.focus()
    }
    button.addEventListener('click', () => show(true))
    close.addEventListener('click', () => show(false))
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !drawer.hidden) show(false) })
    document.head.append(style); document.body.append(button, drawer)
  }).catch(() => {})
}

// Store Reports' page: the shared sidebar with a link to the store report,
// and the report for the store the bar set. The link carries the store, so
// following it keeps the selection. Returns a function that removes the page.
export function drawPage(root = document.body) {
  const address = new URLSearchParams(window.location.search)
  let store = address.get('store') ?? ''
  const view = address.get('view') ?? 'home'

  const sidebar = document.createElement('featherbase-sidebar')
  sidebar.setAttribute('aria-label', 'Store Reports navigation')
  const link = document.createElement('a')
  link.textContent = 'Store report'
  if (view === 'report') link.setAttribute('aria-current', 'page')
  sidebar.append(link)

  const main = document.createElement('main')
  main.dataset.testid = 'store-reports'
  main.dataset.view = view

  const show = () => {
    link.setAttribute('href', `/storereports/?view=report${store ? `&store=${encodeURIComponent(store)}` : ''}`)
    main.dataset.store = store
    main.textContent = view !== 'report' ? 'Store Reports' : store ? `The report for store ${store}` : 'Choose a store'
  }
  const follow = (event) => {
    if (event.detail?.key === 'store') { store = event.detail.value ?? ''; show() }
  }
  show()
  window.addEventListener('featherbase:bar-change', follow)
  root.append(sidebar, main)
  return () => {
    window.removeEventListener('featherbase:bar-change', follow)
    sidebar.remove()
    main.remove()
  }
}

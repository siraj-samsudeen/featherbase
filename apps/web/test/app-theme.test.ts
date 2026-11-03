// #668: an app's page is told the theme the person sees. Under an app's page
// the shared bar paints its own root, and also writes the painted theme,
// light or dark, on the app's root as `data-featherbase-theme` and announces
// each change as `featherbase:theme-change` on window. The Admin's own pages
// get neither. The real bar over the fixture app is in app-page-bar.test.tsx.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

type Paint = typeof import('../src/lib/theme-paint')

let deviceDark = false
let deviceListeners: (() => void)[] = []
let heard: unknown[] = []
const listen = (event: Event) => heard.push((event as CustomEvent).detail)

function flipDevice(dark: boolean) {
  deviceDark = dark
  for (const notify of deviceListeners) notify()
}

/** A fresh copy of the painting module, as each page load has. */
async function freshPaint(): Promise<Paint> {
  vi.resetModules()
  return import('../src/lib/theme-paint')
}

/** The bar's own root, as the bar's mount gives it. */
function barRoot() {
  const root = document.createElement('div')
  document.body.append(root)
  return root
}

const appTheme = () => document.documentElement.getAttribute('data-featherbase-theme')

beforeEach(() => {
  deviceDark = false
  deviceListeners = []
  heard = []
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    get matches() { return deviceDark },
    media: query, onchange: null,
    addEventListener: (_: string, notify: () => void) => { deviceListeners.push(notify) },
    removeEventListener: (_: string, notify: () => void) => { deviceListeners = deviceListeners.filter((n) => n !== notify) },
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList)
  document.documentElement.setAttribute('data-theme', 'app-owned')
  window.addEventListener('featherbase:theme-change', listen)
})

afterEach(() => {
  window.removeEventListener('featherbase:theme-change', listen)
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-featherbase-theme')
  document.body.replaceChildren()
})

test("on an app's page the first paint is written on the app's root and announced once", async () => {
  const paint = await freshPaint()
  const root = barRoot()
  paint.paintOnto(root)
  paint.paintTheme('light')
  expect(root.dataset.theme).toBe('light')
  expect(appTheme()).toBe('light')
  expect(heard).toEqual([{ theme: 'light' }])
})

test("the person's choice wins over the device's", async () => {
  deviceDark = true
  const paint = await freshPaint()
  paint.paintOnto(barRoot())
  paint.paintTheme('light')
  expect(appTheme()).toBe('light')
  expect(heard).toEqual([{ theme: 'light' }])
})

test('a new choice is announced; painting the same theme again is not', async () => {
  const paint = await freshPaint()
  paint.paintOnto(barRoot())
  paint.paintTheme('light')
  paint.paintTheme('dark')
  paint.paintTheme('dark')
  // Following a light device paints light, which the app already has.
  paint.paintTheme('device')
  expect(appTheme()).toBe('light')
  expect(heard).toEqual([{ theme: 'light' }, { theme: 'dark' }, { theme: 'light' }])
})

test('following the device, a flip of the device is announced', async () => {
  const paint = await freshPaint()
  paint.paintOnto(barRoot())
  paint.paintTheme('device')
  flipDevice(true)
  expect(appTheme()).toBe('dark')
  expect(heard).toEqual([{ theme: 'light' }, { theme: 'dark' }])
})

test('with a choice of its own, a flip of the device changes nothing', async () => {
  const paint = await freshPaint()
  paint.paintOnto(barRoot())
  paint.paintTheme('light')
  flipDevice(true)
  expect(appTheme()).toBe('light')
  expect(heard).toEqual([{ theme: 'light' }])
})

test("the app's own theme attribute is never touched", async () => {
  const paint = await freshPaint()
  paint.paintOnto(barRoot())
  paint.paintTheme('dark')
  expect(document.documentElement.getAttribute('data-theme')).toBe('app-owned')
})

test("on Featherbase's own pages there is no app to tell", async () => {
  document.documentElement.removeAttribute('data-theme')
  const paint = await freshPaint()
  paint.paintTheme('dark')
  flipDevice(true)
  paint.paintTheme('device')
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  expect(appTheme()).toBeNull()
  expect(heard).toEqual([])
})

// Review on #668: on a browser with no saved copy of the choice yet, the bar
// first paints the device's theme and whoami then corrects it. The app is told
// both, in order, so it always ends on the person's choice, as the bar does.
test('a first paint corrected by the stored choice is announced, ending on the choice', async () => {
  deviceDark = true
  const paint = await freshPaint()
  paint.paintOnto(barRoot())
  paint.paintTheme('device')
  paint.paintTheme('light')
  expect(appTheme()).toBe('light')
  expect(heard).toEqual([{ theme: 'dark' }, { theme: 'light' }])
})

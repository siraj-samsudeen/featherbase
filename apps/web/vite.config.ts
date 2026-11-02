import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { request } from 'node:http'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import istanbul from 'vite-plugin-istanbul'
import { APP_ROOT_PATTERN, LEGACY_HUMAN_ROOT_PATTERN } from '../../packages/shared/src/app-routes.ts'

// Parallel checkouts (git worktrees) each need their own ports: WEB_PORT
// moves the dev server, API_PORT points the proxy at that checkout's API.
// Defaults match ./init.sh — nothing changes for a single-checkout setup.
const apiPort = Number(process.env.API_PORT ?? 8000)
// The browser's own Host header reaches the API unchanged: the server matches
// it against INSTANCE_ADDRESSES to know which address a request came in on
// (#488). Vite's string shorthand would rewrite it to localhost:<API_PORT>.
const api = { target: `http://localhost:${apiPort}`, changeOrigin: false }

// #488: in production the server answers every page, so on an address that
// opens an app it redirects `/` and the other Featherbase pages to the app's
// root before the SPA loads. In dev, Vite serves those pages itself. So for a
// page navigation to `/` or `/featherbase/*` (never a path the proxy already
// forwards) ask the API the same question, with the browser's Host, and follow
// a redirect it gives; anything else is served as before. The API runs no
// handler for these paths but that redirect, so asking has no side effects.
function addressRedirects(): Plugin {
  return {
    name: 'featherbase-address-redirects',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        const page = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')
        if (!page || !(path === '/' || path.startsWith('/featherbase/'))) return next()
        const ask = request(
          { host: 'localhost', port: apiPort, path: req.url, method: 'GET', headers: { host: req.headers.host ?? '', accept: 'text/html' } },
          (answer) => {
            answer.resume()
            const location = answer.headers.location
            if (answer.statusCode && answer.statusCode >= 300 && answer.statusCode < 400 && location) {
              res.statusCode = answer.statusCode
              res.setHeader('location', location)
              res.end()
            } else next()
          },
        )
        ask.on('error', () => next()) // API not up yet: serve the page as before
        ask.end()
      })
    },
  }
}

// #650: the shared top bar over an installed app's own page. The server's
// copy of the app's entry document loads /featherbase/bar.js (runtime-shell.ts),
// a second entry of this app (src/bar/main.tsx). A build emits it at that
// fixed path beside the SPA (its shared chunks stay hashed under assets/). In
// dev, Vite answers that path with a module that installs the React refresh
// preamble (which index.html gets from Vite, and an app's page does not) and
// then imports the entry's source.
const BAR_ENTRY = 'src/bar/main.tsx'
const BAR_SCRIPT = 'featherbase/bar.js'
function barBundle(): Plugin {
  return {
    name: 'featherbase-bar-bundle',
    config: () => ({
      build: {
        rollupOptions: {
          input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), bar: fileURLToPath(new URL(`./${BAR_ENTRY}`, import.meta.url)) },
          output: { entryFileNames: (chunk) => (chunk.name === 'bar' ? BAR_SCRIPT : 'assets/[name]-[hash].js') },
        },
      },
    }),
    configureServer(server) {
      server.middlewares.use(`/${BAR_SCRIPT}`, (_req, res) => {
        res.setHeader('content-type', 'text/javascript')
        res.setHeader('cache-control', 'no-store')
        res.end(`import RefreshRuntime from '/@react-refresh'
RefreshRuntime.injectIntoGlobalHook(window)
window.$RefreshReg$ = () => {}
window.$RefreshSig$ = () => (type) => type
window.__vite_plugin_react_preamble_installed__ = true
await import('/${BAR_ENTRY}')
`)
      })
    },
  }
}

// ADR 0012: Istanbul instrumentation for the merged web coverage report, so
// the Playwright run counts toward the same numbers as the jsdom suite. Only
// `VITE_COVERAGE=true` (set by `pnpm --filter web coverage:e2e`) adds the
// plugin at all, so the ordinary dev server, ./init.sh and production builds
// get exactly the plugin list they had before. `requireEnv` makes the plugin
// itself refuse to instrument without that variable too.
const coverage = process.env.VITE_COVERAGE === 'true'
  ? [
      istanbul({
        include: 'src/**',
        exclude: ['src/**/*.test.*'],
        extension: ['.ts', '.tsx'],
        requireEnv: true,
        forceBuildInstrument: false,
      }),
    ]
  : []

export default defineConfig({
  plugins: [react(), tailwindcss(), addressRedirects(), barBundle(), ...coverage],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    // Under coverage, no HMR: with it, @vitejs/plugin-react wraps every
    // component in React Fast Refresh registration code, which Istanbul then
    // counts as statements the jsdom run (no refresh) never has — the merge
    // would report phantom code. A test run edits no files, so nothing is lost.
    ...(coverage.length ? { hmr: false } : {}),
    proxy: {
      '/api': api,
      [APP_ROOT_PATTERN]: api,
      [LEGACY_HUMAN_ROOT_PATTERN]: api,
      '/files': api,
      '/private/files': api,
      '/web': api,
      // The dev-preview sign-in link. In production one container answers
      // both the SPA and the API, so this path needs no help; in dev the
      // vite server would otherwise serve index.html for it and the redirect
      // that establishes the session would never happen.
      '/preview': api,
      '/ws': { target: `ws://localhost:${apiPort}`, ws: true },
    },
  },
})

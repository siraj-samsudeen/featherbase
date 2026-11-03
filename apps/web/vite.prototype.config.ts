import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { initialLabRows, labTables, labScenarios, type LabScenario } from './src/gallery/fixtures'

/** Deliberately independent of the normal config: it must contain NO live API proxy. */
function syntheticApi(): Plugin {
  let rows = initialLabRows()
  let scenario: LabScenario = 'populated'
  const loading = new Set<() => void>()
  return {
    name: 'ui-lab-synthetic-api',
    configureServer(server) {
      server.httpServer?.on('upgrade', (request, socket) => {
        // Vite's own development transport is local tooling, not an application API.
        const path = new URL(request.url ?? '/', 'http://prototype.invalid').pathname
        if (path === '/' && request.headers['sec-websocket-protocol'] === 'vite-hmr') return
        socket.destroy()
      })
      server.middlewares.use(async (request, response, next) => {
        response.setHeader('Content-Security-Policy', "connect-src 'self'; form-action 'self'")
        const url = new URL(request.url ?? '/', 'http://prototype.invalid')
        const path = decodeURIComponent(url.pathname)
        if (request.headers.accept?.includes('text/html') && path.startsWith('/featherbase/')) {
          request.url = '/prototype.html'
          return next()
        }
        if (!(path.startsWith('/api/') || path.startsWith('/__lab/') || /^\/(files|private|ws)(\/|$)/.test(path))) return next()
        const send = (data: unknown, status = 200) => {
          response.statusCode = status
          response.setHeader('content-type', 'application/json')
          response.setHeader('cache-control', 'no-store')
          response.end(JSON.stringify(data))
        }
        const refuse = (message: string, status = 501) => send({ error: { type: 'PrototypeRefusal', message } }, status)
        let body: Record<string, unknown> = {}
        try {
          if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
            let raw = ''
            for await (const chunk of request) {
              raw += chunk
              if (raw.length > 64_000) return refuse('Synthetic request is too large', 413)
            }
            body = raw ? JSON.parse(raw) : {}
          }
          if (path === '/__lab/scenario') {
            response.setHeader('x-featherbase-synthetic', 'true')
            if (!['GET', 'POST'].includes(request.method ?? '')) return refuse('Unsupported scenario action', 405)
            if (request.method === 'POST') {
              if (!labScenarios.includes(body.scenario as LabScenario)) return refuse('Unknown synthetic scenario', 400)
              scenario = body.scenario as LabScenario
              rows = initialLabRows()
              for (const finish of loading) finish()
              loading.clear()
            }
            return send({ scenario })
          }
          const who = { name: 'Administrator', email: null, full_name: 'Synthetic designer', roles: ['System Manager'], apps: [], installed_apps: [],
            capabilities: { manage: true, report: false, admin: true, own_grant: true, tables: [], creatable: labTables.map((t) => t.name) } }
          const reads: Record<string, unknown> = {
            '/api/brand': { app_name: 'Featherbase UI Lab', opens: 'admin' }, '/api/whoami': who,
            '/api/runtime_app_versions': [], '/api/app_catalog': [], '/api/home_pages': { pages: [] },
            '/api/events/summary': { entries: [] }, '/api/unread_count': { count: 0 }, '/api/people/waiting_for_access/count': { count: 0 },
            '/api/instance-health': { checks: [], failing: 0, setup_needed: 0, worst: null, setup: { administrator_ready: true, installed_apps: 0, environment: 'prototype', configuration: 'ui' } },
            '/api/settings': { app_name: 'UI Lab', currency: 'INR', currency_precision: 2, float_precision: 2, date_format: 'dd-mon-yyyy' },
            '/api/translations/en': {}, '/api/glossary': { canEdit: false, canAdd: false, terms: [] },
          }
          if (request.method === 'GET' && path in reads) return send(reads[path])
          if (request.method === 'GET' && path.startsWith('/api/user_settings/')) return send({ settings: null })
          if (request.method === 'GET' && path === '/api/saved_views') return send({ views: [] })
          if (request.method === 'GET' && path === '/api/search') return send({ results: [] })
          if (request.method === 'POST' && ['/api/events', '/api/set_theme'].includes(path)) return send({ ok: true })
          if (request.method === 'POST' && path === '/api/row_titles') {
            const requested = body.rows as { table: string; row_id: string }[]
            return send({ titles: requested.flatMap((ref) => {
              const row = rows[ref.table]?.find((r) => r.row_id === ref.row_id)
              return row ? [{ ...ref, title: row.name }] : []
            }) })
          }
          if (request.method === 'GET' && /^\/api\/workflow\/(Lab Project|Lab Task)\/[\w-]+$/.test(path)) return send({ workflow: null })
          if (request.method === 'GET' && /^\/api\/tags\/(Lab Project|Lab Task)\/[\w-]+$/.test(path)) return send({ tags: [] })
          if (request.method === 'GET' && /^\/api\/activity\/(Lab Project|Lab Task)\/[\w-]+$/.test(path)) return send({ comments: [], versions: [] })
          const meta = labTables.find((t) => path === `/api/table/${t.name}:meta`)
          if (request.method === 'GET' && meta) return send(meta)
          if (request.method === 'GET' && path === '/api/table/Table') return send({ data: labTables.map((t) => ({ row_id: t.name, module: 'UI Lab', system: false })), total: labTables.length })
          if (request.method === 'GET' && ['/api/table/Client Script', '/api/table/File', '/api/table/ToDo'].includes(path)) return send({ data: [], total: 0 })
          const match = /^\/api\/table\/(Lab Project|Lab Task)(?:\/([^/:]+))?(?::([a-z_]+))?$/.exec(path)
          if (match) {
            const [, table, id, action] = match
            // Explicit synthetic read contracts only; these do not prove permissions.
            if (request.method === 'GET' && action === 'capabilities') return send({
              write: scenario !== 'permission-limited', rename: false, delete: false,
              submit: false, cancel: false, amend: false, assign: false, tag: false, comment: false, upload: false,
            })
            if (request.method === 'GET' && action === 'connections') return send({ connections: table === 'Lab Project' && scenario !== 'permission-limited'
              ? ['project', 'review_project'].map((column) => ({ table: 'Lab Task', column, via: null,
                count: scenario === 'empty' ? 0 : rows['Lab Task'].filter((row) => row[column] === id).length,
                filters: [[column, '=', id]],
              })) : [] })
            if (request.method === 'GET' && !action) {
              if (scenario === 'error') return refuse('Synthetic load failed. Choose another scenario to retry.', 503)
              if (scenario === 'permission-limited') return refuse('Simulated permission restriction — not a security test', 403)
              if (scenario === 'loading') {
                const finish = () => refuse('Synthetic loading ended', 503)
                loading.add(finish)
                response.once('close', () => loading.delete(finish))
                return
              }
              let data = scenario === 'empty' ? [] : rows[table]
              const filters = JSON.parse(url.searchParams.get('filters') ?? '[]') as [string, string, unknown][]
              for (const [key, operator, value] of filters) {
                if (operator === '=') data = data.filter((row) => row[key] === value)
                else if (operator === 'like') data = data.filter((row) => String(row[key] ?? '').toLowerCase().includes(String(value).replaceAll('%', '').toLowerCase()))
                else return refuse(`Unsupported synthetic filter: ${operator}`, 400)
              }
              if (id) return data.find((r) => r.row_id === id) ? send(data.find((r) => r.row_id === id)) : refuse('No synthetic row', 404)
              const order = /^(\w+) (asc|desc)$/.exec(url.searchParams.get('order_by') ?? 'name asc')
              if (!order || !['row_id', ...labTables.find((t) => t.name === table)!.columns.map((c) => c.column_name)].includes(order[1])) return refuse('Unsupported synthetic sort', 400)
              data = [...data].sort((a, b) => String(a[order[1]] ?? '').localeCompare(String(b[order[1]] ?? '')) * (order[2] === 'asc' ? 1 : -1))
              const start = Math.max(0, Number(url.searchParams.get('limit_start') ?? 0))
              const limit = Math.max(0, Number(url.searchParams.get('limit_page_length') ?? 20))
              return send({ data: data.slice(start, start + limit), total: data.length })
            }
          }
          if (request.method === 'POST' && path === '/api/save_row') {
            if (scenario === 'permission-limited') return refuse('Simulated save restriction', 403)
            const table = String(body.table)
            const row = body.row as Record<string, unknown>
            const current = rows[table]?.find((r) => r.row_id === row?.row_id)
            if (!current || !row.name) return refuse('Synthetic save requires an existing named row', 400)
            Object.assign(current, row, { updated_at: new Date().toISOString() })
            return send(current)
          }
          return refuse(`No synthetic response for ${request.method} ${path}. Nothing was forwarded.`)
        } catch {
          return refuse('Invalid synthetic request', 400)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), syntheticApi()],
  server: { port: Number(process.env.PROTOTYPE_PORT ?? 5373), strictPort: true, hmr: false },
})

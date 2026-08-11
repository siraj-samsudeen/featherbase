// PROTOTYPE — throwaway. The "connection console" design for connecting a
// data source (winner of the A/B/C exploration; A and C live in git history
// on this branch). Table picker is its own page via ?step=tables. No real
// mutations: test/introspect are simulated.
import { useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'

// ---- shared mock data & simulated backend ---------------------------------

const MOCK_SCHEMAS: { schema: string; tables: { name: string; cols: number; pk: string | null; preview: string[] }[] }[] = [
  {
    schema: 'public',
    tables: [
      { name: 'vehicles', cols: 12, pk: 'id', preview: ['id', 'plate_no', 'model', 'capacity_kg', 'status'] },
      { name: 'trips', cols: 18, pk: 'trip_id', preview: ['trip_id', 'vehicle_id', 'driver_id', 'origin', 'destination', 'started_at'] },
      { name: 'drivers', cols: 9, pk: 'id', preview: ['id', 'name', 'license_no', 'phone', 'joined_on'] },
      { name: 'maintenance', cols: 11, pk: 'id', preview: ['id', 'vehicle_id', 'service_date', 'cost', 'workshop'] },
      { name: 'audit_log', cols: 6, pk: null, preview: ['at', 'actor', 'action', 'detail'] },
    ],
  },
  {
    schema: 'analytics',
    tables: [
      { name: 'daily_kpis', cols: 8, pk: 'day', preview: ['day', 'trips', 'km_run', 'fuel_cost', 'utilization'] },
      { name: 'vehicle_costs', cols: 7, pk: null, preview: ['vehicle_id', 'month', 'fuel', 'maintenance', 'total'] },
    ],
  },
]

type TestOutcome =
  | { kind: 'idle' }
  | { kind: 'running'; phase: number }
  | { kind: 'timeout' }
  | { kind: 'auth' }
  | { kind: 'ok' }

const CHECK_PHASES = ['Resolve DNS', 'Reach the port', 'Negotiate TLS', 'Authenticate', 'Check read access']

// Each Test click advances the demo through the outcomes we want to judge.
function useSimulatedTest() {
  const [outcome, setOutcome] = useState<TestOutcome>({ kind: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const run = () => {
    const target: TestOutcome['kind'] = attempt === 0 ? 'timeout' : attempt === 1 ? 'auth' : 'ok'
    const failAt = target === 'timeout' ? 1 : target === 'auth' ? 3 : CHECK_PHASES.length
    setOutcome({ kind: 'running', phase: 0 })
    let phase = 0
    const tick = () => {
      phase += 1
      if (phase >= failAt) {
        setOutcome({ kind: target })
        setAttempt((a) => a + 1)
        return
      }
      setOutcome({ kind: 'running', phase })
      setTimeout(tick, 450)
    }
    setTimeout(tick, 450)
  }
  return { outcome, run }
}

function OutcomeBanner({ outcome, port }: { outcome: TestOutcome; port: string }) {
  if (outcome.kind === 'timeout')
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2.5 text-sm">
        <div className="font-medium text-red-800">No answer from the server (timeout after 8s)</div>
        <p className="mt-1 text-red-700">
          The host resolved but port {port} didn&apos;t answer. This is almost always a firewall — on AWS
          RDS, check the security group&apos;s inbound rules. Your password was not checked yet.
        </p>
      </div>
    )
  if (outcome.kind === 'auth')
    return (
      <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm">
        <div className="font-medium text-amber-800">The server refused the login</div>
        <p className="mt-1 text-amber-700">
          The network path works — the database rejected user <code className="font-mono">analyst</code>.
          Check the password, and that the user exists on the target database.
        </p>
      </div>
    )
  if (outcome.kind === 'ok')
    return (
      <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2.5 text-sm">
        <div className="font-medium text-emerald-800">Connected — MySQL 8.4.10, TLS on, 142 ms</div>
        <p className="mt-1 text-emerald-700">
          Role <code className="font-mono">analyst</code> can read 2 schemas, 7 tables.
        </p>
      </div>
    )
  return null
}

// ---- connection form: one state, two views (fields + masked URL) ----------

type Engine = 'MySQL' | 'Postgres' | 'DuckDB' | 'CSV folder'
const ENGINES: Engine[] = ['MySQL', 'Postgres', 'DuckDB', 'CSV folder']
const SCHEME: Record<string, string> = { MySQL: 'mysql', Postgres: 'postgres' }
const DEFAULT_PORT: Record<string, string> = { MySQL: '3306', Postgres: '5432' }

function useConnForm() {
  const [f, setF] = useState({
    engine: 'MySQL' as Engine,
    name: 'vms',
    host: 'database-1.cu94as0wos8e.us-east-1.rds.amazonaws.com',
    port: '3306',
    database: 'vms',
    user: 'analyst',
    password: 'secretsecret',
  })
  const setEngine = (engine: Engine) =>
    setF((prev) => ({
      ...prev,
      engine,
      // Swap the default port only if the user hasn't customized it.
      port: Object.values(DEFAULT_PORT).includes(prev.port) ? (DEFAULT_PORT[engine] ?? prev.port) : prev.port,
    }))
  return { f, setF, setEngine }
}
type ConnForm = ReturnType<typeof useConnForm>

function CredFields({ form }: { form: ConnForm }) {
  const { f, setF } = form
  const [urlFocused, setUrlFocused] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const scheme = SCHEME[f.engine] ?? 'mysql'
  // The URL box is a second view of the same state, password masked.
  const maskedUrl = `${scheme}://${f.user}${f.password ? ':••••••••' : ''}@${f.host}:${f.port}/${f.database}`
  const parseUrl = (text: string) => {
    setUrlDraft(text)
    try {
      const u = new URL(text.trim())
      const s = u.protocol.replace(/:$/, '')
      if (!['mysql', 'postgres', 'postgresql'].includes(s)) return
      setF((prev) => ({
        ...prev,
        engine: s === 'mysql' ? 'MySQL' : 'Postgres',
        host: u.hostname || prev.host,
        port: u.port || DEFAULT_PORT[s === 'mysql' ? 'MySQL' : 'Postgres'],
        database: u.pathname.replace(/^\//, '') || prev.database,
        user: u.username ? decodeURIComponent(u.username) : prev.user,
        // ••• is our own mask round-tripping back in — keep the stored secret.
        password: u.password && !/^•+$/.test(u.password) ? decodeURIComponent(u.password) : prev.password,
      }))
    } catch {
      // keep typing — not a URL yet
    }
  }
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }))
  return (
    <div className="space-y-4">
      <div>
        <label className="fc-label">Connection URL <span className="font-normal text-[var(--color-ink-faint)]">— paste to fill the form; password stays masked</span></label>
        <input
          className="fc-input font-mono"
          value={urlFocused ? urlDraft : maskedUrl}
          onFocus={() => {
            setUrlDraft(maskedUrl)
            setUrlFocused(true)
          }}
          onBlur={() => setUrlFocused(false)}
          onChange={(e) => parseUrl(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="fc-label">Host</label>
          <input className="fc-input font-mono" value={f.host} onChange={set('host')} />
        </div>
        <div>
          <label className="fc-label">Port</label>
          <input className="fc-input font-mono" value={f.port} onChange={set('port')} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="fc-label">Database</label>
          <input className="fc-input font-mono" value={f.database} onChange={set('database')} />
        </div>
        <div>
          <label className="fc-label">User</label>
          <input className="fc-input font-mono" value={f.user} onChange={set('user')} />
        </div>
        <div>
          <label className="fc-label">Password</label>
          <input className="fc-input" type="password" value={f.password} onChange={set('password')} />
        </div>
      </div>
      <div className="flex items-center gap-6 text-sm text-[var(--color-ink-muted)]">
        <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> Require TLS</label>
        <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> Read-only</label>
      </div>
    </div>
  )
}

// ---- connect page ---------------------------------------------------------

function ConnectConsole({ goTables }: { goTables: () => void }) {
  const form = useConnForm()
  const { f, setF, setEngine } = form
  const { outcome, run } = useSimulatedTest()
  const sqlEngine = f.engine === 'MySQL' || f.engine === 'Postgres'
  const phaseState = (i: number): 'pending' | 'running' | 'ok' | 'fail' => {
    if (outcome.kind === 'idle') return 'pending'
    if (outcome.kind === 'running') return i < outcome.phase ? 'ok' : i === outcome.phase ? 'running' : 'pending'
    const failAt = outcome.kind === 'timeout' ? 1 : outcome.kind === 'auth' ? 3 : CHECK_PHASES.length
    return i < failAt ? 'ok' : i === failAt && outcome.kind !== 'ok' ? 'fail' : outcome.kind === 'ok' ? 'ok' : 'pending'
  }
  return (
    <div className="mx-auto max-w-5xl py-8 grid grid-cols-5 gap-6">
      <div className="fc-card col-span-3 p-6">
        <h2 className="text-base font-semibold mb-1">Connect to {f.engine}</h2>
        <p className="text-sm text-[var(--color-ink-muted)] mb-4">Credentials are encrypted and never shown again.</p>
        <div className="mb-4 inline-flex rounded-[var(--radius-control)] border border-[var(--color-border-strong)] p-0.5">
          {ENGINES.map((e) => (
            <button
              key={e}
              onClick={() => setEngine(e)}
              className={`rounded px-3 py-1 text-sm ${e === f.engine ? 'bg-[var(--color-brand)] text-white font-medium' : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)]'}`}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="mb-4">
          <label className="fc-label">Source name <span className="font-normal text-[var(--color-ink-faint)]">— how this connection appears in Featherbase</span></label>
          <input className="fc-input font-mono !w-56" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
        </div>
        {sqlEngine ? (
          <CredFields form={form} />
        ) : (
          <div className="rounded-md border border-dashed border-[var(--color-border-strong)] px-4 py-6 text-sm text-[var(--color-ink-muted)]">
            {f.engine === 'DuckDB'
              ? 'DuckDB connects with a MotherDuck token or a .duckdb file path — different form, out of scope for this prototype.'
              : 'A CSV folder needs only a server-side directory path — different form, out of scope for this prototype.'}
          </div>
        )}
        {sqlEngine && (
          <div className="mt-5 flex justify-end">
            <button className="fc-btn-primary" onClick={run} disabled={outcome.kind === 'running'}>
              {outcome.kind === 'idle' ? 'Test connection' : outcome.kind === 'ok' ? 'Re-test' : 'Retry'}
            </button>
          </div>
        )}
      </div>
      <div className="col-span-2 space-y-4">
        <div className="fc-card p-4">
          <h3 className="text-sm font-semibold mb-3">Live checks</h3>
          <ol className="space-y-2">
            {CHECK_PHASES.map((p, i) => {
              const st = phaseState(i)
              return (
                <li key={p} className="flex items-center gap-2 text-sm">
                  <span
                    className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                      st === 'ok' ? 'bg-emerald-500 text-white' : st === 'fail' ? 'bg-red-500 text-white' : st === 'running' ? 'bg-[var(--color-brand)] text-white animate-pulse' : 'border border-[var(--color-border-strong)]'
                    }`}
                  >
                    {st === 'ok' ? '✓' : st === 'fail' ? '✕' : ''}
                  </span>
                  <span className={st === 'pending' ? 'text-[var(--color-ink-faint)]' : ''}>{p}</span>
                </li>
              )
            })}
          </ol>
        </div>
        <OutcomeBanner outcome={outcome} port={f.port} />
        {outcome.kind === 'ok' && (
          <button className="fc-btn-primary w-full justify-center" onClick={goTables}>
            Save &amp; choose tables →
          </button>
        )}
      </div>
    </div>
  )
}

// ---- table picker (its own page: ?step=tables) ----------------------------

function TablesPage({ goBack }: { goBack: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(['public.vehicles', 'public.trips']))
  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  const [schema, setSchema] = useState('public')
  const [open, setOpen] = useState<string | null>('public.trips')
  const tables = MOCK_SCHEMAS.find((s) => s.schema === schema)?.tables ?? []
  return (
    <div className="mx-auto max-w-5xl py-8 flex gap-6">
      <div className="w-48 shrink-0">
        <button className="fc-btn mb-4 w-full justify-center" onClick={goBack}>← Connection</button>
        <div className="fc-card p-2">
          {MOCK_SCHEMAS.map((s) => (
            <button
              key={s.schema}
              onClick={() => setSchema(s.schema)}
              className={`w-full rounded px-3 py-1.5 text-left text-sm font-mono ${s.schema === schema ? 'bg-[var(--color-subtle)] font-medium' : 'hover:bg-[var(--color-subtle)]'}`}
            >
              {s.schema}
              <span className="ml-2 text-xs text-[var(--color-ink-faint)]">{s.tables.length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1">
        <div className="fc-card divide-y divide-[var(--color-border)]">
          {tables.map((t) => {
            const key = `${schema}.${t.name}`
            return (
              <div key={key}>
                <div className={`flex items-center gap-3 px-4 py-2.5 text-sm ${t.pk ? '' : 'opacity-60'}`}>
                  <input type="checkbox" disabled={!t.pk} checked={selected.has(key)} onChange={() => toggle(key)} />
                  <button className="font-mono hover:underline" onClick={() => setOpen(open === key ? null : key)}>
                    {t.name}
                  </button>
                  <span className="ml-auto text-xs text-[var(--color-ink-faint)]">
                    {t.cols} columns · {t.pk ? `pk: ${t.pk}` : 'no pk'}
                  </span>
                </div>
                {open === key && (
                  <div className="bg-[var(--color-subtle)] px-11 py-2 flex flex-wrap gap-1.5">
                    {t.preview.map((c) => (
                      <span key={c} className="fc-pill border border-[var(--color-border)] bg-[var(--color-surface)] font-mono">{c}</span>
                    ))}
                    {t.cols > t.preview.length && (
                      <span className="fc-pill text-[var(--color-ink-faint)]">+{t.cols - t.preview.length} more</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <button className="fc-btn-primary">Reflect {selected.size} tables</button>
        </div>
      </div>
    </div>
  )
}

// ---- page -----------------------------------------------------------------

export function PrototypeConnectSourcePage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { step?: string }
  const step = search.step === 'tables' ? 'tables' : 'connect'
  const go = (s: 'connect' | 'tables') => navigate({ to: '.', search: { step: s }, replace: true })
  return (
    <div className="min-h-full px-6" data-testid="prototype-connect-source">
      <div className="mx-auto max-w-5xl pt-4">
        <span className="fc-pill bg-amber-100 text-amber-800">Prototype — throwaway. Test button cycles: timeout → bad password → success</span>
      </div>
      {step === 'tables' ? <TablesPage goBack={() => go('connect')} /> : <ConnectConsole goTables={() => go('tables')} />}
    </div>
  )
}

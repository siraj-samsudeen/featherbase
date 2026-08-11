// PROTOTYPE — throwaway. Three variants of the "connect a data source"
// experience, switchable via ?variant=A|B|C, with the table picker as its own
// page via ?step=tables. No real mutations: test/introspect are simulated.
// Question being answered: what should the connect + reflect flow look like?
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'

type Variant = 'A' | 'B' | 'C'
type Step = 'connect' | 'tables'

const VARIANT_NAMES: Record<Variant, string> = {
  A: 'Guided wizard',
  B: 'Connection console',
  C: 'Catalog + drawer',
}

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

const CHECK_PHASES = ['Resolve DNS', 'Reach port 3306', 'Negotiate TLS', 'Authenticate', 'Check read access']

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
  return { outcome, run, attempt }
}

function OutcomeBanner({ outcome }: { outcome: TestOutcome }) {
  if (outcome.kind === 'timeout')
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2.5 text-sm">
        <div className="font-medium text-red-800">No answer from the server (timeout after 8s)</div>
        <p className="mt-1 text-red-700">
          The host resolved but port 3306 didn&apos;t answer. This is almost always a firewall — on AWS
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
          Check the password, and that the user exists on database <code className="font-mono">vms</code>.
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

function CredFields({ compact }: { compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className="rounded-md border border-dashed border-[var(--color-border-strong)] px-3 py-2 text-sm text-[var(--color-ink-faint)] font-mono">
        Paste a mysql:// or postgres:// URL to fill the form
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="fc-label">Host</label>
          <input className="fc-input font-mono" defaultValue="database-1.cu94as0wos8e.us-east-1.rds.amazonaws.com" />
        </div>
        <div>
          <label className="fc-label">Port</label>
          <input className="fc-input font-mono" defaultValue="3306" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="fc-label">Database</label>
          <input className="fc-input font-mono" defaultValue="vms" />
        </div>
        <div>
          <label className="fc-label">User</label>
          <input className="fc-input font-mono" defaultValue="analyst" />
        </div>
        <div>
          <label className="fc-label">Password</label>
          <input className="fc-input" type="password" defaultValue="secretsecret" />
        </div>
      </div>
      <div className="flex items-center gap-6 text-sm text-[var(--color-ink-muted)]">
        <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> Require TLS</label>
        <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> Read-only</label>
      </div>
    </div>
  )
}

// ---- table picking (shared selection state, three different layouts) ------

function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set(['public.vehicles', 'public.trips']))
  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  return { selected, toggle }
}

// ---- Variant A: guided wizard with a step rail ----------------------------

function VariantAConnect({ goTables }: { goTables: () => void }) {
  const [step, setStep] = useState(0)
  const { outcome, run } = useSimulatedTest()
  const steps = ['Engine', 'Credentials', 'Verify', 'Tables']
  return (
    <div className="mx-auto max-w-4xl flex gap-8 py-8">
      <ol className="w-44 shrink-0 space-y-1">
        {steps.map((s, i) => (
          <li key={s}>
            <button
              onClick={() => (i === 3 ? goTables() : setStep(i))}
              className={`w-full text-left px-3 py-2 rounded-md text-sm ${i === step ? 'bg-[var(--color-subtle)] font-medium text-[var(--color-ink)]' : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)]'}`}
            >
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border-strong)] text-xs">
                {i + 1}
              </span>
              {s}
            </button>
          </li>
        ))}
      </ol>
      <div className="fc-card flex-1 p-6">
        {step === 0 && (
          <div>
            <h2 className="text-base font-semibold mb-4">Choose an engine</h2>
            <div className="grid grid-cols-2 gap-3">
              {['MySQL', 'Postgres', 'DuckDB', 'CSV folder'].map((e, i) => (
                <button
                  key={e}
                  onClick={() => setStep(1)}
                  className={`fc-card p-4 text-center text-sm hover:border-[var(--color-brand)] ${i === 0 ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]/20' : ''}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 1 && (
          <div>
            <h2 className="text-base font-semibold mb-4">Enter credentials</h2>
            <CredFields />
            <div className="mt-6 flex justify-between">
              <button className="fc-btn" onClick={() => setStep(0)}>Back</button>
              <button className="fc-btn-primary" onClick={() => setStep(2)}>Next: verify</button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div>
            <h2 className="text-base font-semibold mb-4">Verify the connection</h2>
            <div className="space-y-3">
              {outcome.kind === 'running' && (
                <div className="text-sm text-[var(--color-ink-muted)]">Testing… {CHECK_PHASES[outcome.phase]}</div>
              )}
              <OutcomeBanner outcome={outcome} />
              <div className="flex justify-between">
                <button className="fc-btn" onClick={() => setStep(1)}>Back</button>
                {outcome.kind === 'ok' ? (
                  <button className="fc-btn-primary" onClick={goTables}>Next: pick tables</button>
                ) : (
                  <button className="fc-btn-primary" onClick={run} disabled={outcome.kind === 'running'}>
                    {outcome.kind === 'idle' ? 'Test connection' : 'Retry test'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function VariantATables({ goBack }: { goBack: () => void }) {
  const { selected, toggle } = useSelection()
  const [filter, setFilter] = useState('')
  const rows = MOCK_SCHEMAS.flatMap((s) => s.tables.map((t) => ({ ...t, schema: s.schema, key: `${s.schema}.${t.name}` })))
    .filter((r) => r.key.includes(filter))
  return (
    <div className="mx-auto max-w-3xl py-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Pick tables to reflect</h2>
          <p className="text-sm text-[var(--color-ink-muted)]">vms · connected as analyst · read-only</p>
        </div>
        <input className="fc-input !w-56" placeholder="Filter tables" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="fc-card divide-y divide-[var(--color-border)]">
        {rows.map((r) => (
          <label key={r.key} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${r.pk ? 'cursor-pointer hover:bg-[var(--color-subtle)]' : 'opacity-60'}`}>
            <input type="checkbox" disabled={!r.pk} checked={selected.has(r.key)} onChange={() => toggle(r.key)} />
            <span className="font-mono">{r.key}</span>
            <span className="ml-auto text-xs text-[var(--color-ink-faint)]">
              {r.cols} columns · {r.pk ? `pk: ${r.pk}` : 'no pk — cannot reflect'}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex justify-between">
        <button className="fc-btn" onClick={goBack}>Back to connection</button>
        <button className="fc-btn-primary">Reflect {selected.size} tables</button>
      </div>
    </div>
  )
}

// ---- Variant B: connection console (form + live checks side by side) ------

function VariantBConnect({ goTables }: { goTables: () => void }) {
  const { outcome, run } = useSimulatedTest()
  const [engine, setEngine] = useState('MySQL')
  const ENGINES = ['MySQL', 'Postgres', 'DuckDB', 'CSV folder']
  const phaseState = (i: number): 'pending' | 'running' | 'ok' | 'fail' => {
    if (outcome.kind === 'idle') return 'pending'
    if (outcome.kind === 'running') return i < outcome.phase ? 'ok' : i === outcome.phase ? 'running' : 'pending'
    const failAt = outcome.kind === 'timeout' ? 1 : outcome.kind === 'auth' ? 3 : CHECK_PHASES.length
    return i < failAt ? 'ok' : i === failAt && outcome.kind !== 'ok' ? 'fail' : outcome.kind === 'ok' ? 'ok' : 'pending'
  }
  return (
    <div className="mx-auto max-w-5xl py-8 grid grid-cols-5 gap-6">
      <div className="fc-card col-span-3 p-6">
        <h2 className="text-base font-semibold mb-1">Connect to {engine}</h2>
        <p className="text-sm text-[var(--color-ink-muted)] mb-4">Credentials are encrypted and never shown again.</p>
        <div className="mb-4 inline-flex rounded-[var(--radius-control)] border border-[var(--color-border-strong)] p-0.5">
          {ENGINES.map((e) => (
            <button
              key={e}
              onClick={() => setEngine(e)}
              className={`rounded px-3 py-1 text-sm ${e === engine ? 'bg-[var(--color-brand)] text-white font-medium' : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)]'}`}
            >
              {e}
            </button>
          ))}
        </div>
        <CredFields />
        <div className="mt-5 flex justify-end">
          <button className="fc-btn-primary" onClick={run} disabled={outcome.kind === 'running'}>
            {outcome.kind === 'idle' ? 'Test connection' : outcome.kind === 'ok' ? 'Re-test' : 'Retry'}
          </button>
        </div>
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
        <OutcomeBanner outcome={outcome} />
        {outcome.kind === 'ok' && (
          <button className="fc-btn-primary w-full justify-center" onClick={goTables}>
            Choose tables →
          </button>
        )}
      </div>
    </div>
  )
}

function VariantBTables({ goBack }: { goBack: () => void }) {
  const { selected, toggle } = useSelection()
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

// ---- Variant C: catalog cards + slide-over drawer -------------------------

function VariantCConnect({ goTables }: { goTables: () => void }) {
  const [drawer, setDrawer] = useState(false)
  const { outcome, run } = useSimulatedTest()
  return (
    <div className="mx-auto max-w-4xl py-8">
      <h2 className="text-base font-semibold mb-1">Data sources</h2>
      <p className="text-sm text-[var(--color-ink-muted)] mb-5">Connect an external store and reflect its tables into Featherbase.</p>
      <div className="grid grid-cols-3 gap-4">
        {[
          { name: 'MySQL', desc: 'RDS MySQL 8, MariaDB, PlanetScale' },
          { name: 'Postgres', desc: 'RDS, Supabase, Neon, or any Postgres 12+' },
          { name: 'DuckDB', desc: 'MotherDuck or a local .duckdb file' },
          { name: 'CSV folder', desc: 'A directory of CSV files on the server' },
        ].map((e, i) => (
          <button key={e.name} onClick={() => setDrawer(true)} className="fc-card p-5 text-left hover:border-[var(--color-brand)]">
            <div className="text-sm font-semibold">{e.name}</div>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{e.desc}</p>
            {i === 0 && <span className="fc-pill mt-3 bg-[var(--color-subtle)]">Most used</span>}
          </button>
        ))}
      </div>
      {drawer && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setDrawer(false)}>
          <div className="h-full w-[440px] overflow-y-auto bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold">Connect MySQL</h3>
              <button className="fc-btn" onClick={() => setDrawer(false)}>✕</button>
            </div>
            <CredFields compact />
            <div className="mt-4 space-y-3">
              {outcome.kind === 'running' && (
                <div className="text-sm text-[var(--color-ink-muted)]">Testing… {CHECK_PHASES[outcome.phase]}</div>
              )}
              <OutcomeBanner outcome={outcome} />
              {outcome.kind === 'ok' ? (
                <button className="fc-btn-primary w-full justify-center" onClick={goTables}>Save &amp; pick tables →</button>
              ) : (
                <button className="fc-btn-primary w-full justify-center" onClick={run} disabled={outcome.kind === 'running'}>
                  {outcome.kind === 'idle' ? 'Test connection' : 'Retry test'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function VariantCTables({ goBack }: { goBack: () => void }) {
  const { selected, toggle } = useSelection()
  return (
    <div className="mx-auto max-w-4xl py-8 pb-24">
      <button className="fc-btn mb-4" onClick={goBack}>← vms connection</button>
      {MOCK_SCHEMAS.map((s) => (
        <div key={s.schema} className="mb-6">
          <h3 className="mb-2 text-sm font-semibold font-mono text-[var(--color-ink-muted)]">{s.schema}</h3>
          <div className="grid grid-cols-2 gap-3">
            {s.tables.map((t) => {
              const key = `${s.schema}.${t.name}`
              const on = selected.has(key)
              return (
                <button
                  key={key}
                  disabled={!t.pk}
                  onClick={() => toggle(key)}
                  className={`fc-card p-4 text-left ${!t.pk ? 'opacity-50' : on ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]/20' : 'hover:border-[var(--color-border-strong)]'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono font-medium">{t.name}</span>
                    {on && <span className="fc-pill bg-[var(--color-brand)] text-white">selected</span>}
                    {!t.pk && <span className="fc-pill bg-[var(--color-subtle)]">no pk</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.preview.slice(0, 4).map((c) => (
                      <span key={c} className="fc-pill border border-[var(--color-border)] text-[var(--color-ink-faint)] font-mono text-[11px]">{c}</span>
                    ))}
                    <span className="fc-pill text-[var(--color-ink-faint)] text-[11px]">{t.cols} cols</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div className="fixed bottom-16 left-1/2 z-30 -translate-x-1/2">
        <button className="fc-btn-primary shadow-lg">Reflect {selected.size} selected tables</button>
      </div>
    </div>
  )
}

// ---- switcher + page ------------------------------------------------------

function PrototypeSwitcher({ variant, setVariant }: { variant: Variant; setVariant: (v: Variant) => void }) {
  const order: Variant[] = ['A', 'B', 'C']
  const cycle = (dir: 1 | -1) => {
    const i = (order.indexOf(variant) + dir + order.length) % order.length
    setVariant(order[i])
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (e.key === 'ArrowLeft') cycle(-1)
      if (e.key === 'ArrowRight') cycle(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (import.meta.env.PROD) return null
  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-xl">
      <button onClick={() => cycle(-1)} aria-label="Previous variant" className="hover:text-gray-300">←</button>
      <span className="font-medium">
        {variant} — {VARIANT_NAMES[variant]}
      </span>
      <button onClick={() => cycle(1)} aria-label="Next variant" className="hover:text-gray-300">→</button>
    </div>
  )
}

export function PrototypeConnectSourcePage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { variant?: string; step?: string }
  const variant: Variant = search.variant === 'B' ? 'B' : search.variant === 'C' ? 'C' : 'A'
  const step: Step = search.step === 'tables' ? 'tables' : 'connect'
  const set = (v: Variant, s: Step) =>
    navigate({ to: '.', search: { variant: v, step: s }, replace: true })
  const goTables = () => set(variant, 'tables')
  const goConnect = () => set(variant, 'connect')
  const body = useMemo(() => {
    if (variant === 'A') return step === 'tables' ? <VariantATables goBack={goConnect} /> : <VariantAConnect goTables={goTables} />
    if (variant === 'B') return step === 'tables' ? <VariantBTables goBack={goConnect} /> : <VariantBConnect goTables={goTables} />
    return step === 'tables' ? <VariantCTables goBack={goConnect} /> : <VariantCConnect goTables={goTables} />
  }, [variant, step])
  return (
    <div className="min-h-full px-6" data-testid="prototype-connect-source">
      <div className="mx-auto max-w-5xl pt-4">
        <span className="fc-pill bg-amber-100 text-amber-800">Prototype — throwaway. Test button cycles: timeout → bad password → success</span>
      </div>
      {body}
      <PrototypeSwitcher variant={variant} setVariant={(v) => set(v, step)} />
    </div>
  )
}

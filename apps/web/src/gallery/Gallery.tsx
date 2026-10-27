import { useState, type ReactNode } from 'react'
import {
  Button,
  buttonClasses,
  achievementTone,
  Card,
  DataList,
  EmptyState,
  Headline,
  Field,
  Notice,
  PasswordInput,
  SearchInput,
  Select,
  Skeleton,
  StatusPill,
  TextInput,
  ToastProvider,
  useToast,
  type DataColumn,
} from '../components/ui'
import { fmtCount, fmtINR, fmtPct } from '../lib/inr'
import { ExternalLink, Moon, Plus, Sun } from '../components/ui/icons'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-bold uppercase tracking-wide text-ink-muted">{title}</h2>
      {children}
    </section>
  )
}

function ToastDemo() {
  const toast = useToast()
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast({ tone: 'positive', message: 'Checklist saved' })}>Show a confirmation</Button>
      <Button variant="danger" onClick={() => toast({ tone: 'negative', message: 'Could not save. Check your connection and try again.' })}>
        Show a failure
      </Button>
    </div>
  )
}

// Sample figures only (invented); store codes are real.
interface Line {
  name: string
  target: number
  sales: number
}
const LINES: Line[] = [
  { name: 'Men Casual Shirt', target: 1_62_000, sales: 1_21_000 },
  { name: 'Men T Shirt', target: 93_000, sales: 58_000 },
  { name: 'Men Formal Shirt', target: 1_38_000, sales: 1_42_000 },
]
const pct = (l: Line) => (l.sales / l.target) * 100
// One key for every example list; the empty one never asks for it.
const lineKey = (l: Line) => l.name

const LINE_COLUMNS: DataColumn<Line>[] = [
  { key: 'name', header: 'Subcategory', cell: (l) => l.name, phone: 'title' },
  {
    key: 'ach',
    header: 'Achievement',
    align: 'end',
    phone: 'status',
    cell: (l) => <StatusPill tone={achievementTone(pct(l))}>{fmtPct(Math.round(pct(l) * 10) / 10)}</StatusPill>,
  },
  { key: 'target', header: 'Target', align: 'end', cell: (l) => fmtINR(l.target) },
  { key: 'sales', header: 'Sales', align: 'end', cell: (l) => fmtINR(l.sales) },
  { key: 'gap', header: 'Gap', align: 'end', cell: (l) => fmtINR(l.sales - l.target, { signed: true }) },
  { key: 'qty', header: 'Pieces', align: 'end', phone: 'hidden', cell: (l) => fmtCount(Math.round(l.sales / 450)) },
]

export function Gallery() {
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  function flip() {
    const next = !dark
    document.documentElement.dataset.theme = next ? 'dark' : 'light'
    setDark(next)
  }
  return (
    <ToastProvider>
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 bg-canvas px-4 py-6 text-ink">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Components</h1>
          <Button onClick={flip} icon={dark ? <Sun aria-hidden size={18} /> : <Moon aria-hidden size={18} />}>
            {dark ? 'Light' : 'Dark'}
          </Button>
        </header>

        <Section title="Buttons">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Plus aria-hidden size={18} />}>Start a checklist</Button>
            <Button>Secondary</Button>
            <Button variant="quiet">Quiet</Button>
            <Button variant="danger">Delete</Button>
            <Button variant="primary" loading>Saving</Button>
            <a href="#full-report" className={buttonClasses()}>
              <ExternalLink aria-hidden size={18} />
              Link as a button
            </a>
          </div>
          <Button variant="primary" block>Sign in</Button>
        </Section>

        <Section title="Fields">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employee code" hint="As printed on your ID card">
              <TextInput placeholder="RR-0107" autoCapitalize="characters" />
            </Field>
            <Field label="Password">
              <PasswordInput placeholder="StyleHR password" />
            </Field>
            <Field label="Store">
              <Select defaultValue="1501">
                <option value="1501">1501 Attakulangara</option>
                <option value="1515">1515 Kattakada</option>
              </Select>
            </Field>
            <Field label="Quantity" error="Enter a number of 1 or more">
              <TextInput defaultValue="0" inputMode="numeric" />
            </Field>
          </div>
          <SearchInput aria-label="Search checklists" placeholder="Search checklists" />
        </Section>

        <Section title="Status, in words">
          <div className="flex flex-wrap gap-2">
            <StatusPill tone="negative">Overdue</StatusPill>
            <StatusPill tone="caution">Near target</StatusPill>
            <StatusPill tone="positive">Done</StatusPill>
            <StatusPill tone="opportunity">Opportunity</StatusPill>
            <StatusPill tone="missing">No target set</StatusPill>
            <StatusPill>In progress</StatusPill>
          </div>
        </Section>

        <Section title="Notices">
          <Notice>Forgot your password? Reset it in StyleHR, or ask your Store Manager.</Notice>
          <Notice tone="caution">Test mode: StyleHR is not asked. Enter an employee code to open that person's view.</Notice>
          <Notice tone="negative">The report couldn't load right now. Try again in a few minutes.</Notice>
          <Notice tone="positive">Your password has been updated.</Notice>
        </Section>

        <Section title="Card, empty state, loading">
          <Card title="Checklists" actions={<Button variant="quiet">See all</Button>}>
            <EmptyState
              title="No checklists yet"
              body="Runs you start appear here, newest first."
              action={<Button variant="primary">Start a checklist</Button>}
            />
          </Card>
          <Card className="p-4">
            <Skeleton label="Loading your numbers" lines={4} />
          </Card>
        </Section>

        <Section title="Report headline">
          <Headline
            label="Month to date · 01-Oct-2026 to 21-Oct-2026"
            conclusion={`${fmtINR(72_000)} behind`}
            tone={achievementTone(81.7)}
            detail={`81.7% of target: ${fmtINR(3_21_000)} sold of ${fmtINR(3_93_000)}`}
            progress={{ value: 81.7, marker: 90, label: 'Achievement' }}
          />
        </Section>

        <Section title="List (a table when wide, cards on a phone)">
          <DataList
            caption="Where the gap is"
            rows={LINES}
            columns={LINE_COLUMNS}
            rowKey={lineKey}
            empty={{ title: 'No targets this month', body: 'Targets appear here once they are set for your Sections.' }}
          />
          <DataList
            caption="Long values wrap inside a phone card"
            rows={[{ name: 'SKU-0123456789012345678901234567890123456789-SAREE-KANCHIPURAM', target: 1_62_000, sales: 1_21_000 }]}
            columns={[
              ...LINE_COLUMNS.slice(0, 1),
              { key: 'status', header: 'Status', phone: 'status', cell: () => <StatusPill tone="caution">Awaiting second-level approval from the regional office</StatusPill> },
              { key: 'meta', header: 'Reference', phone: 'meta', cell: () => 'https://example.invalid/a/very/long/reference/path/without/any/spaces/at/all' },
              { key: 'v', header: 'AVeryLongMetadataDerivedColumnHeaderWithoutSpaces', cell: (l) => fmtINR(l.sales) },
            ]}
            rowKey={lineKey}
            empty={{ title: 'Nothing to show', body: 'This example always has one row.' }}
          />
          <DataList
            caption="Checklist runs"
            rows={[] as Line[]}
            columns={LINE_COLUMNS}
            rowKey={lineKey}
            empty={{ title: 'No checklists yet', body: 'Runs you start appear here.', action: <Button variant="primary">Start a checklist</Button> }}
          />
        </Section>

        <Section title="Toasts">
          <ToastDemo />
        </Section>
      </main>
    </ToastProvider>
  )
}

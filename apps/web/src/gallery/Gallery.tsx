import { useState, type ReactNode } from 'react'
import {
  Button,
  buttonClasses,
  Card,
  EmptyState,
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
} from '../components/ui'
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
              <TextInput placeholder="RR-6761" autoCapitalize="characters" />
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
          <Notice tone="negative">The report session could not be created. This is not a sales figure.</Notice>
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

        <Section title="Toasts">
          <ToastDemo />
        </Section>
      </main>
    </ToastProvider>
  )
}

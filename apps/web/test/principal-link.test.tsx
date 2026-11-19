// #1264: whoever acted (Activity, comments, history, Created By) is a link to
// their record: a person to their Person row, a service account to its Service
// Account row. The system's own actors have no record and read as a phrase.
// A viewer who may not open the record reads the name as plain words.
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { rowHref, signInActor, SYSTEM_ACTOR_LABELS } from 'shared'
import { ActorName, PrincipalLink, principalTable } from '../src/lib/people'

const PERSON = 'psn_aaaaaaaaaaaaaaaaaaaa'
const SERVICE = 'svc_bbbbbbbbbbbbbbbbbbbb'
type Viewer = { manage: boolean; tables: string[] }

function shown(ui: React.ReactElement, viewer: Viewer, names: Record<string, string> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(['whoami'], { capabilities: { ...viewer, admin: viewer.manage, own_grant: true, creatable: [], archived: [] }, roles: [] })
  for (const [id, name] of Object.entries(names)) client.setQueryData(['principal-name', id], name)
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
const MANAGER: Viewer = { manage: true, tables: [] }
const READER: Viewer = { manage: false, tables: ['Ticket'] }

describe('principalTable', () => {
  it('a person is a Person record, a service account a Service Account record, a system actor none', () => {
    expect(principalTable(PERSON)).toBe('Person')
    expect(principalTable('Administrator')).toBe('Person')
    expect(principalTable(SERVICE)).toBe('Service Account')
    expect(principalTable(signInActor('google'))).toBeNull()
  })
})

describe('PrincipalLink', () => {
  it('links a person to their Person record for a System Manager', () => {
    shown(<PrincipalLink id={PERSON} />, MANAGER, { [PERSON]: 'Meena Raman' })
    expect(screen.getByRole('link', { name: 'Meena Raman' })).toHaveAttribute('href', rowHref('Person', PERSON))
  })

  it('links a person for a reader of Person too', () => {
    shown(<PrincipalLink id={PERSON} />, { manage: false, tables: ['Person'] }, { [PERSON]: 'Meena Raman' })
    expect(screen.getByRole('link', { name: 'Meena Raman' })).toBeInTheDocument()
  })

  it('reads as plain words for a viewer who may not open Person', () => {
    shown(<PrincipalLink id={PERSON} />, READER, { [PERSON]: 'Meena Raman' })
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Meena Raman').closest('[data-record-link]')).toHaveAttribute('data-record-link', 'text')
  })

  it('links a service account to its Service Account record', () => {
    shown(<PrincipalLink id={SERVICE} />, MANAGER, { [SERVICE]: 'Nightly sync' })
    expect(screen.getByRole('link', { name: 'Nightly sync' })).toHaveAttribute('href', rowHref('Service Account', SERVICE))
  })

  it("a system actor reads as its phrase, never a link", () => {
    const google = signInActor('google')
    shown(<PrincipalLink id={google} />, MANAGER)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(SYSTEM_ACTOR_LABELS[google])).toBeInTheDocument()
  })

  it('a person with no name yet, or none at all, is never shown by their id', async () => {
    shown(<PrincipalLink id={PERSON} />, MANAGER)
    expect(screen.queryByText(PERSON)).toBeNull()
  })

  it('ActorName links with the name the server gave', () => {
    shown(<ActorName id={SERVICE} name="Automation (Nightly sync)" />, MANAGER)
    expect(screen.getByRole('link', { name: 'Automation (Nightly sync)' })).toHaveAttribute('href', rowHref('Service Account', SERVICE))
  })

  it('ActorName for a system step reads as the phrase the server gave', () => {
    shown(<ActorName id="system:import" name="Import" />, MANAGER)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Import')).toBeInTheDocument()
  })
})

// The Report access page's team parts (#1217): what a Team Report Manager sees instead of the
// company-wide tools. Their picker has two layouts behind a toggle, so the owner can compare them
// in the real app: a list of the team (the default) or type a name.
import { Field, Segmented, Select } from '@featherbase/shop-floor'
import { personDetail, type Who } from './person-identity'

/** Someone in the team, with who they are (#1216): two people in one team can share a name. */
export interface TeamMember extends Who { person: string; name: string }
export type PickerLayout = 'list' | 'search'
const LAYOUTS: { value: PickerLayout; label: string }[] = [{ value: 'list', label: 'Team list' }, { value: 'search', label: 'Type a name' }]
const LAYOUT_KEY = 'dash.team-picker-layout'

/** The picker layout: the address's `picker`, else the one last chosen here, else the team list. */
export function startPickerLayout(search = window.location.search): PickerLayout {
  const asked = new URLSearchParams(search).get('picker')
  let kept: string | null = null
  try { kept = window.localStorage.getItem(LAYOUT_KEY) } catch { /* private window: no memory */ }
  const value = asked ?? kept
  return LAYOUTS.some(l => l.value === value) ? value as PickerLayout : 'list'
}
export function keepPickerLayout(layout: PickerLayout) {
  try { window.localStorage.setItem(LAYOUT_KEY, layout) } catch { /* private window: no memory */ }
}

export function PickerToggle({ value, onChange }: { value: PickerLayout; onChange: (layout: PickerLayout) => void }) {
  return (
    <div className="flex items-center gap-2 self-end" data-testid="picker-toggle">
      <span className="text-sm text-ink-muted">Choose people by</span>
      <Segmented label="Choose people by" options={LAYOUTS} value={value} onChange={layout => { keepPickerLayout(layout); onChange(layout) }} />
    </div>
  )
}

/** Says why the page is narrower than a company-wide manager's. */
export function TeamNote({ team }: { team: TeamMember[] }) {
  return (
    <p className="fd-muted" data-testid="team-note">
      {team.length === 0
        ? 'You give reports to the people who report to you, and nobody reports to you today. Ask the master data team if that is wrong.'
        : `You give reports to your team: the ${team.length === 1 ? 'one person' : `${team.length} people`} who report to you. You can give only reports you can open yourself.`}
    </p>
  )
}

/** Choose someone from the team, by name. */
export function TeamSelect({ team, chosen, onChoose, label }: { team: TeamMember[]; chosen: TeamMember | null; onChoose: (member: TeamMember | null) => void; label: string }) {
  return (
    <Field label={label} className="min-w-56 flex-1">
      <Select value={chosen?.person ?? ''} onChange={event => onChoose(team.find(member => member.person === event.target.value) ?? null)} data-testid="team-select">
        <option value="">{team.length ? 'Choose someone in your team' : 'Nobody reports to you'}</option>
        {/* A list option is plain text: the name, then who they are, as one line. */}
        {team.map(member => <option key={member.person} value={member.person}>{[member.name, personDetail(member)].filter(Boolean).join(' · ')}</option>)}
      </Select>
    </Field>
  )
}

import type { Ticket } from './api'
import { configuredTypes, person, stateLabel } from './ticket-words'

export const isDone = (ticket: Ticket) =>
  configuredTypes[ticket.kind]
    ? configuredTypes[ticket.kind].done.includes(ticket.ticket_state)
    : ticket.ticket_state === 'Resolved'
// A state's words decide its Shop Floor tone; the colour only repeats them.
type Tone = 'negative' | 'caution' | 'positive' | 'opportunity' | 'missing' | 'neutral'
export const tone = (ticket: Ticket): Tone => {
  const words = ticket.ticket_state.toLowerCase()
  if (isDone(ticket)) return 'positive'
  if (/reject|declin|cancel|fail/.test(words)) return 'negative'
  if (/fixed|verify\b/.test(words)) return 'opportunity'
  if (/^new$|^open$/.test(words)) return 'missing'
  if (/need|await|wait|review|question|hold|blocked/.test(words)) return 'caution'
  return 'neutral'
}
export function StatePill({ ticket }: { ticket: Ticket }) {
  return (
    <span className={`pill tone-${tone(ticket)}`}>
      {stateLabel(ticket.ticket_state)}
    </span>
  )
}
export const assignee = (ticket: Ticket) =>
  ticket.assigned_to ? person(ticket.assigned_to) : 'Unassigned'

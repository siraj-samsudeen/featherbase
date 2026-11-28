// #1397: a ticket may sit under a parent ticket, one level deep. The parent's page lists
// its sub-tickets; each sub-ticket names its parent. Every ticket is a link that opens it here.
import { RecordLink } from '@featherbase/shop-floor'
import type { Ticket } from './api'
import { StatePill, isDone } from './ticket-state'
import { short } from './ticket-words'

const TICKET_TABLE = 'tickets.ticket'
export const ticketHref = (id: string) => `/tickets/?ticket=${encodeURIComponent(id)}`

/** One ticket as a link that opens it in place; a modified click opens its own address. */
export function TicketLink({ ticket, open }: { ticket: Pick<Ticket, 'row_id' | 'title'>; open: (id: string) => void }) {
  return <RecordLink table={TICKET_TABLE} rowId={ticket.row_id} name={`${short(ticket.row_id)} ${ticket.title}`}
    href={ticketHref(ticket.row_id)} onNavigate={() => open(ticket.row_id)} />
}

/** "M open of N", the header's fact for a parent. */
export const subTicketsFact = (children: Ticket[]) =>
  `${children.filter((child) => !isDone(child)).length} open of ${children.length}`

export function SubTicketsCard({ children, open }: { children: Ticket[]; open: (id: string) => void }) {
  if (!children.length) return null
  return (
    <section className="card sub-tickets" id="sub-tickets" aria-label="Sub-tickets">
      <h3>Sub-tickets</h3>
      <ul className="sub-ticket-list">
        {children.map((child) => (
          <li key={child.row_id}>
            <TicketLink ticket={child} open={open} />
            <StatePill ticket={child} />
          </li>
        ))}
      </ul>
    </section>
  )
}

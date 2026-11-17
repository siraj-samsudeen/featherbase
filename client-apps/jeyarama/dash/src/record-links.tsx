// #1240: every record Dash shows is a link (the UI standard's rule 1), drawn with the shared
// RecordLink (#1234). Dash's links to other apps' records are made here and nowhere else.
import { RecordLink } from '@featherbase/shop-floor'

/** A ticket's page in Tickets. */
export const ticketHref = (id: string) => `/tickets/?ticket=${encodeURIComponent(id)}`

/** A ticket, by its number, opening on Tickets' own page. Only the raiser's own tickets are shown, so they may open each. */
export function TicketLink({ id }: { id: string }) {
  return <RecordLink table="tickets.ticket" rowId={id} name={id} href={ticketHref(id)} />
}

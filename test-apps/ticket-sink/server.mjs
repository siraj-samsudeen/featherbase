// #927 tests: stands in for Tickets' create action, keeping each ticket asked for.
export const platformVersion = '2026-10'
export const actions = {
  async create({ payload, documents }) {
    const ticket = await documents.create('ticketsink.ticket', { title: payload.title, kind: payload.kind, payload: JSON.stringify(payload) })
    return { ticket }
  },
}

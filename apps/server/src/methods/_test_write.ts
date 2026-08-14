import { whitelist } from '../methods'

// A write-effect method, used to prove the dispatcher's verb guard: a method
// that mutates REQUIRES POST, and a GET must be refused *before* the handler
// runs (#62 bug 2 — GET on a mutating method used to execute it straight from
// the query string, a live CSRF vector given the sid cookie is sameSite:
// 'Lax'). That regression was pinned against frappe.client.delete until the
// Frappe compatibility layer was removed; every remaining native method is
// read-effect, so without this fixture the guard would go untested.
//
// Deliberately harmless: the "mutation" is an in-memory counter, so the
// method is safe to ship whitelisted (unlike a real delete would be). The
// companion read method is how a test observes whether the handler ran —
// asserting the refusal alone cannot tell a rejected call from an executed
// one that happened to return an error.
let writes = 0

whitelist(
  '_test_write',
  () => {
    writes += 1
    return { writes }
  },
  { effect: 'write' },
)

whitelist('_test_write_count', () => ({ writes }), { effect: 'read' })

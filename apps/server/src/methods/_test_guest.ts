import { whitelist } from '../methods'

// A guest-allowed method, used to prove allowGuest bypasses the session
// requirement (API-003). Harmless: echoes a fixed payload.
whitelist('public_info', () => ({ product: 'Frappe Clone', public: true }), {
  allowGuest: true,
})

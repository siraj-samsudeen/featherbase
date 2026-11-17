## Context

A session today is a signed token in the httpOnly `sid` cookie. The page keeps a copy in `localStorage` and sends it as a Bearer header, and the header wins. Every request checks the token in full: its signature, expiry, the sign-out list, the person's "sessions ended" time, whether they are turned off, and whether the identity it used was ended. Siraj picked option A with storage S1 on 17-Nov-2026 (https://claude.ai/artifact/5zMZK2e8gZKcH44mTsq8nE).

## Decisions

### D1. The browser's accounts are held in a second httpOnly cookie, read only by the switcher
`sid_accounts` holds the browser's accounts as a list of ordinary session tokens, each with when it was last used. It is httpOnly, Secure on a secure address, SameSite=Lax, and its Path is `/api/accounts`. Page scripts can't read it, and only the switcher's routes receive it. Nothing about a session changes, so every existing check and revocation applies to a held account unchanged.
*Rejected (S2):* a server-side record per browser that mints a fresh session at each switch. It adds a table, a second way to mint sessions, and revocation by two ids. The protection is the same: whoever holds the browser's key holds every account, just as with the cookie.

### D2. The list includes the active account; the active one is `sid`
The list is every account on this browser, the active one included. An account joins the list the first time the switcher sees its `sid` (the page asks after every sign-in, and the Account menu asks when it mounts). Sign-in routes don't need the list, so its Path can stay narrow.
*Rejected:* a list of only the other accounts, filled by "Add another account". Any sign-in that bypassed that button, such as a refused Google round trip that came back, would silently drop the account it replaced.

### D3. A switch is checked on the server and returns the token as sign-in does
`POST /api/accounts/switch` names an account by its session id. The server finds that session in the list and checks it as any request is checked. It ends any View as on the departing session, sets `sid`, and answers as sign-in does: token, person and landing. The page stores the token and reloads. A browser can only choose among the sessions it already holds; it never supplies a token.

### D4. A held session that ended says why, and is not removed silently
The list check names the reason: it ran out, it was signed out, the person's sessions were ended, the person was turned off, or the sign-in method was ended. The account stays listed as "Signed out" with that reason and a Sign in action, until the person signs in again or removes it, or 30 days after its session's end. The list's cookie lives 30 days past its longest session, so a return after a long absence still finds it. An entry whose signature fails is dropped without a word, since it names no one.

### D5. At most five accounts per browser
The active account plus four. When the list is full of live accounts, "Add another account" and "Use another account" say so and ask the person to remove one. An ended account gives way to a new sign-in without asking. If a sign-in still arrives when five live accounts are held (the page refuses it first), the least recently used leaves the list and its session is ended, so no live session sits off the list. Five tokens keep the cookie well under the browser's 4 KB limit.

### D6. Signing out from the page goes through the switcher
"Sign out" ends this account's session (as `/api/logout` does, View as included), removes it from the list, and continues as the most recently used live account, or shows the sign-in page if none is left. "Sign out of all accounts" ends every session on the list and clears both cookies. `/api/logout` stays for callers without the list.

### D7. The Access Log tells who sat on which browser
- `account_switch`: recorded under the account switched to, naming the account switched from.
- `account_added`: recorded under the account joining the list, once for each live account already on it ("signed in on the same browser as …").

Changes are recorded as the active account, as today. When Rony acts for RB she is signed in as RB, and the log shows RB's session sat on the same browser as hers.

### D8. View as and the switcher don't combine
The switcher's routes read only the cookies, never the request's viewed person, so the routes behave the same while viewing. A switch, a sign-out or a removal ends any View as on the session it leaves. View as never mints a session, so no viewed person can enter the list.

### D9. Every tab follows the account
`localStorage` is shared by a browser's tabs. When the signed-in account changes in one tab, every other tab reloads, so no page keeps showing one account while acting as another.

### D10. An account row is a switch, not a record shown
In the sign-in chooser and under "Switch to", each row is one button that continues as that account. The person's name inside it is plain text, not a RecordLink. A row there is a way to switch account, not a record on display, and a link inside the button would make one click do two things. (Siraj, 17-Nov-2026: an exception to "every record shown is a link".)

### Deliberately not handled
- The "signed in on the same browser as …" row (D7) is written just after a sign-in, not inside it. If that one write fails, the account still works and only that extra row is missing. The sign-in's own row and every switch's row are always written. A private window skips the list anyway. (Codex adversarial round 3; Siraj, 17-Nov-2026: set aside.)
- No strict per-request check that the page's token is still the one it loaded with. Every tab reloads when the signed-in account changes in another tab (D9), and many pages and tests write the token directly.

```mermaid
sequenceDiagram
  participant P as Page
  participant S as /api/accounts
  P->>S: switch {session}
  S->>S: find it in sid_accounts, check it in full
  S->>S: end View as on the old sid, log account_switch
  S-->>P: Set-Cookie sid, sid_accounts; token, person, landing
  P->>P: store the token, reload (other tabs reload too)
```

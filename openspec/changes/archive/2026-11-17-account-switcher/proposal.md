## Why

Several people hold more than one Featherbase account. Siraj has a StyleHR ID and a jeyarama.com login. RB has several logins, and Rony sometimes acts for RB with his authorization. Today, moving between accounts means signing out and typing a password again (#1255). View as (#1222) doesn't help here: it only looks, and these people need to act as each account.

## What Changes

- One browser holds up to five signed-in accounts. Each is a real session from a real sign-in, with its own expiry. No password is stored.
- The sign-in page opens on "Choose an account" when accounts are held on this browser. The last used is on top, and one click continues as an account without a password. An account whose session ended says so and offers Sign in with its ID filled in.
- The Account menu lists the other held accounts under "Switch to", one click each. It also has "+ Add another account", "Sign out" (this account) and "Sign out of all accounts".
- A switch is a swap on the server. It checks the chosen session as fully as any request does, ends any View as, and is recorded in the Access Log. An account joining a browser that already holds others is recorded as "signed in on the same browser as …".
- Signing out from the page ends the session and takes it off the browser's list. If other accounts are held, the page continues as the next one.

## Capabilities

### New Capabilities

- `account-switcher`: several signed-in accounts on one browser, one click apart.

### Modified Capabilities

## Impact

- Server: a second httpOnly cookie, scoped to the new `/api/accounts` routes (list, add, switch, remove, sign out, sign out of all). A check that names why a held session ended. Access Log rows `account_switch` and `account_added`.
- Web: the sign-in page's account chooser, the Account menu's accounts section, the page's sign-out going through the switcher, and every open tab reloading when the account changes in another tab.
- No migration, no new Table.

## 1. Tests first

- [ ] 1.1 Server test: the list (joins on first sight, the reasons a held session ended, a forged entry dropped, the cap); switch (checked in full, View as ended, logged, refused for a session not on the list); add; remove; sign out (continues as the next live account); sign out of all; the cookie's attributes and path
- [ ] 1.2 Web tests: the chooser on the sign-in page; the Account menu's accounts section; tabs reload when the account changes

## 2. Server

- [ ] 2.1 Why a session ended, reused by the request check
- [ ] 2.2 The `sid_accounts` cookie and the `/api/accounts` routes; the Access Log rows

## 3. Web

- [ ] 3.1 The sign-in page's account chooser
- [ ] 3.2 The Account menu's accounts section, sign-out through the switcher, and tabs following the account
- [ ] 3.3 The UI verifier against #1255's checklist, with desktop screenshots

## 4. Close

- [ ] 4.1 Codex standard and adversarial reviews until clean; the full suites and browser suites; archive this change

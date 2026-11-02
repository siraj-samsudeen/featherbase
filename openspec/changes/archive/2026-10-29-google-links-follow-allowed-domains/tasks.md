# Tasks

## 1. Self-link follows the domain rule

- [x] 1.1 Refuse a self-link the method's allowed domains do not admit, before any read or write, with a result code the sign-in methods page explains.
- [x] 1.2 Test: an allowed company account links; another domain, or a company address without the hosted-domain claim, is refused and writes nothing; with no domains listed, any account links.

## 2. Sign-in through an existing link

- [x] 2.1 Re-check sign-ins through links the domain rule made; keep administrator links and claimed invites.
- [x] 2.2 Count only links that still pass the domains as a way in, and guard a domain-list change against locking out an Administrator or System Manager.
- [x] 2.3 Test: a pre-fix self link is refused and restored when the list is cleared; an administrator's link still signs in; dropping a domain ends its rule-made links; narrowing that would lock out a System Manager is refused until they have another way in.

## 3. Sessions through a link no longer admitted (Siraj, 30-Oct-2026)

- [x] 3.1 When a Google domain-list change stops admitting a self, new-person or expected-sign-in link, end the sessions opened through it in the same transaction, after the lockout guard; log once per person, with no address.
- [x] 3.2 Test: a self-linked session ends, an administrator-linked and a password session survive, re-widening does not revive it, and a change that keeps the link admitted ends nothing.

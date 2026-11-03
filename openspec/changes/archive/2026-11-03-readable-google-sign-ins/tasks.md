## 1. Acceptance first

- [x] 1.1 Step definitions for "A claimed Google invite reads as who and when": fail for the right reason (the row leads with the account number)

## 2. Implementation

- [x] 2.1 A linked Google row leads with the address, then linked when and how, then last used; the account number moves under "Details"; component tests pin the wording
- [x] 2.2 Unlink's confirmation says the Google account will no longer sign in as the person

## 3. Completion

- [x] 3.1 Focused web tests, typecheck, strict OpenSpec validation, effective acceptance, boot smoke
- [x] 3.2 Independent headless check at 1280px against the issue's "Done when"
- [x] 3.3 Sync the delta into the main spec and archive the change

Focused checks: the sign-in-methods component tests passed (12), the new acceptance scenario passed against the
real stack with a mock Google first sign-in, and web typecheck and strict OpenSpec validation passed. One
ordinary review round by a different Claude model found no level 1 or level 2 defect. The independent headless
verifier at 1280px passed items 2 to 5 on #837. Item 1 lacked the "·" between "Google" and the address, which
f58fffd fixes. Codex could not review because its usage limit was reached.

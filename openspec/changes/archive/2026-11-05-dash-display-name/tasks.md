## 1. Tests first

- [x] 1.1 Step definitions, page objects and Dash's tests expect "Dash". Run them and see them fail on the old name.

## 2. The name

- [x] 2.1 The manifest's `title`, the page title and the copy on Dash's pages say "Dash".
- [x] 2.2 The instance's `app_name` and privacy notice, and `INTERIM_APPS`, say "Dash".
- [x] 2.3 The docs that name the app, and the `MAIL_FROM` example, say "Dash".

## 3. The version

- [x] 3.1 Dash goes to 0.10.4 with an empty version step, and `previousVersions` gains 0.10.3 at its release commit.

## 4. Verify and archive

- [x] 4.1 Dash's tests, typecheck and build pass, and the platform tests that read the name.
- [x] 4.2 An independent verifier checks #966's checklist against the real UI in a headless browser at 1280.
- [x] 4.3 Archive the change.

## 1. Acceptance first

- [ ] 1.1 Step definitions for "The app's page follows the person's choice over the device's" and "A theme change reaches the open app's page", against the bar-proof app: fail for the right reason (the app's page is never told the theme)

## 2. Implementation

- [ ] 2.1 On an app's page the bar writes the painted theme on the document's root as `data-featherbase-theme` and announces each change with `featherbase:theme-change`; unit tests pin first paint, a choice, a device flip under "same as device", and no announcement for an unchanged theme or on the Admin's own pages
- [ ] 2.2 The bar-proof page follows the theme (attribute-driven style plus the event), leaving its own `data-theme` and body styling untouched
- [ ] 2.3 Browser test: the app's page follows the person's choice over the device's, and a switch reaches it without a reload

## 3. Completion

- [ ] 3.1 Focused web and browser tests, typecheck, `openspec validate app-pages-follow-theme --type change --strict`, full effective acceptance with no pending steps, boot smoke
- [ ] 3.2 Sync the delta into the main spec and archive the change

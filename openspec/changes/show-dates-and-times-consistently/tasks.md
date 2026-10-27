## 1. Fixes, test first

- [x] 1.1 #390: a Datetime reads DD-Mon-YYYY HH:MM on the viewer's clock; flip the pin in `display-settings.test.ts`; IST 00:00, 05:29, 05:30, UTC and New York cases.
- [x] 1.2 #421: history records a Date change as the day; the timeline formats changed values by column type, including history recorded before the fix.
- [x] 1.3 #539: older run days read DD-Mon-YYYY; Today and Yesterday follow the reader's calendar.

## 2. Verification

- [ ] 2.1 Independent screenshot verifier at 1280 and 375 px, light and dark, against the checklists on #390, #421 and #539; independent reviewer for the server half of #421.
- [ ] 2.2 Server, web and shared suites, both typechecks and the repository checks; archive this change in the same PR.

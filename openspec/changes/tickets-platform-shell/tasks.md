## 1. Acceptance tests first

- [ ] 1.1 Step definitions and page objects for the `tickets-workspace` and accent scenarios. Run them and see each fail for the expected reason.

## 2. Accent: a platform feature

- [ ] 2.1 The platform's accent names (`blue`, `green`) in `shared`. Install refuses an unknown `accent` in an app's manifest and lists the known names (server test first).
- [ ] 2.2 The runtime shell writes `data-featherbase-accent` on the served document's `<html>` and on the bar host when the app names an accent, and writes neither when it names none (unit test first).
- [ ] 2.3 Shop Floor gets one light and one dark token block per accent, re-valuing only the action and focus tokens. The design-guard contrast test runs on every accent × theme.
- [ ] 2.4 The bar and the sidebar set the accent on the same element as their painted theme, so the accent follows a theme switch (unit tests first).

## 3. Tickets in the shell

- [ ] 3.1 Tickets' stylesheet moves onto Shop Floor tokens, with no literal colours (guarded by a test). Its manifest names `"accent": "green"`.
- [ ] 3.2 Views and ticket types, with their counts, in `<featherbase-sidebar>`. The connection status line goes at its foot, linking to Tickets' settings. Tickets' own rail, header, headline, subtitle and connections banner go.
- [ ] 3.3 One toolbar row (view name and count, search, state filter, New ticket). Below it, the list beside the selected ticket, each scrolling on its own.
- [ ] 3.4 The ticket header card: ID · type, state pill, title, the facts (Assigned to, Raised by, Updated), and an actions row with a button for each action available now that opens its form. Then the tabs, and a short empty state when nothing is selected.
- [ ] 3.5 Tickets version bump with its (empty) migration step.

## 4. Check and release

- [ ] 4.1 The full acceptance suite for this change passes, and the unit, web and app tests stay green.
- [ ] 4.2 An independent verifier runs the real UI headless at 1280px against the #941 checklist and returns a spec-vs-built table. Fix every difference.
- [ ] 4.3 Run `openspec validate tickets-platform-shell --type change --strict`, sync the specs and archive this change as the branch's last commit.

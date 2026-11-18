## 1. The shared sidebar

- [x] 1.1 The collapsed choice is the signed-in person's, read and written by the store itself. Verify `apps/web/test/scenarios/app-navigation-sidebar.test.tsx` ("Viewing as someone keeps the tester's own sidebar"), `apps/web/test/app-sidebar-collapse.test.tsx`.
- [x] 1.2 The edge drags the open sidebar's width (200–360px, kept per person, written once per frame); a click folds it. Verify `scenarios/app-navigation-sidebar.test.tsx` ("The sidebar is as wide as the person makes it"), `app-sidebar-collapse.test.tsx`, `admin-sidebar-rail.test.tsx`.
- [x] 1.3 The rail keeps the avatar, Help and Theme, stacked; the open row waits until the sidebar has widened. Verify `app-sidebar-collapse.test.tsx`, `admin-sidebar-rail.test.tsx`.
- [x] 1.4 Hover labels: Collapse with its key, Help, Theme, open or folded; every rail control in an app named too; no key on the row, no browser tooltip. Verify `scenarios/app-navigation-sidebar.test.tsx` ("The collapse control names its key on hover"), `sidebar-collapse.test.tsx`, `app-sidebar-rail.test.tsx`.
- [x] 1.5 The app sidebar's frame is drawn above the page; the pickers' strip under it. Verify `app-sidebar-collapse.test.tsx`; headless measure in Dash with a report (every menu 100% visible).
- [x] 1.7 The Theme menu is a short list with a tick. Verify `app-sidebar-collapse.test.tsx`.

## 2. Keyboard shortcuts

- [x] 2.1 The sidebar's shortcut brings no tip or reminder; its uses still show in the list. Verify `apps/web/test/scenarios/keyboard-shortcuts.test.tsx` ("Collapsing the sidebar by mouse brings no tip").
- [x] 2.2 The tip, reminder and quiet scenarios use opening search. Verify `scenarios/keyboard-shortcuts.test.tsx`.

## 3. Hand-over

- [ ] 3.1 The owner tries it on localhost and approves before it is pushed.

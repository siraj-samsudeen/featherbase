## Why

The owner's review of #1227 (17-Nov-2026): a collapsed sidebar disappeared completely, and its only control, a panel icon in the top bar, looked out of place. He wants the icons kept when collapsed, and chose option A of the design (an icon rail with its control on the sidebar), #1248.

## What Changes

- Collapsed, every sidebar is a 56px icon rail instead of hidden: icons only, labels as tooltips, headings as rules, long lists of one kind folded into one icon with a menu.
- The collapse control is the sidebar's own footer row and its edge; the top bar keeps only the phone's menu button.
- Ctrl/Cmd+B, the remembered choice and the phone drawer are unchanged.

## Capabilities

### Modified Capabilities

- `app-navigation`: a collapsed sidebar is a rail, and the control is on the sidebar.

## Impact

`apps/web` (the shared sidebar element, the Admin sidebar, the top bar), Tickets 0.2.19 and Dash 0.13.21 (icons and initials for the rail).

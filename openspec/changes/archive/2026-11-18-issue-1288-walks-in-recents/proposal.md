## Why

A plain list or row page showed a lone "Recent paths" button on a row of its own, only so a remembered walk could be reopened after signing in (#1288). The UI owner chose option B (18-Nov-2026): the walk becomes an entry in the sidebar's Recently Opened, where people already look for what they opened.

## What Changes

- With one step, a list or row page shows no path bar and no Recent paths button.
- Each remembered walk is one entry in the sidebar's Recently Opened, in time order among recent pages and records. It is marked with a path icon in the sidebar's muted colour and named by its steps ("Category › Sarees › Rows"). Opening it opens the whole walk.
- Walks are still remembered in the person's settings, now with when each was last taken, so they survive signing in.
- A filtered recent reads as its list's chips do ("Full Name contains a · Email contains example"), not the stored operator ("Full Name like %a%").

## Capabilities

### New Capabilities

### Modified Capabilities

- `record-workspace`: a remembered walk is reopened from Recently Opened, not from a lone Recent paths button.

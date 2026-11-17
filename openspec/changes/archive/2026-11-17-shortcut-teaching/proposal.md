## Why

Featherbase has keyboard shortcuts that most people never find, and people who do learn one forget it a few days later (#1251). Siraj wants Featherbase to teach them quietly and to remind a person when they slip back to the mouse, without tours or pop-ups. Saved views (#1250) adds a set of shortcuts next, so the teaching comes first and every page gets it.

## What Changes

- One list of shortcuts that a page adds to. The first two are the existing collapse-the-sidebar and command-search keys, which keep working exactly as before.
- A control with a shortcut shows its key in its hover text.
- A Keyboard Shortcuts panel (the `?` key, or a button in the top bar) lists the page's shortcuts with whether the person uses each one, and puts a small key badge on every control while open.
- A quiet tip after the third mouse use in a row of something that has a key; a reminder when a person who knew the key goes back to the mouse. Each ignored tip doubles the wait.
- Tips can be quieted for a week, then a month, then three months; never forever.
- What a person has learnt is kept in their own settings, so it follows them to any device.

## Capabilities

### New Capabilities

- `keyboard-shortcuts`: shortcuts a person can see, look up, and is taught and reminded of.

## Impact

- Web only. The history is stored in the person's existing settings record; no new Table, route or migration.
- The top bar gains one button. The sidebar and command-search keys gain one line each to report use.

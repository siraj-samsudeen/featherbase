## Why

An address the server could not open as an app (a mistyped root such as `/equipment/`, or an app that is off or missing) got a raw "Application unavailable" page: no top bar, always light, browser-blue links, a 32px heading, no page language, and "Sign in" shown to someone already signed in (audit F09, #1328).

## What Changes

- Such an address goes to `/featherbase/unavailable?address=…`, which draws the shared ProblemPage (#1327) under the top bar, in the person's theme.
- The address is repeated as text only, and only as a plain relative path, at most 200 long. Anything else reads "the address you asked for".
- "<App> is turned off" is the server's answer, given only to someone who could use the app. Signed out, or without access, the page says only that nothing is available there.
  - Signed out, only an app that is on goes to sign-in.
- One way forward: "Go to Featherbase", or "Open your apps" for someone whose place is an app.

## Capabilities

### New Capabilities

### Modified Capabilities

- `app-navigation`: an address nothing answers says so on the shared page.

## Why

An app's page under the shared top bar is never told the theme the person chose (#668). Featherbase's own
pages follow the person's choice, but an app can only follow the device. So a person who picked light on a
dark-mode device sees the bar in light and the app in dark.

## What Changes

- An app's page is told the theme the person sees, light or dark: when the page opens and whenever it
  changes, including when the choice is "same as device" and the device flips.
- Featherbase still never restyles the app's page; the app decides how to follow.
- The bar-proof test app follows the theme, so the promise is executed by the acceptance suite.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trusted-runtime-packages`: an app's page follows the person's theme choice.

## Impact

The shared bar bundle's theme painting (web), the bar-proof fixture, its browser and acceptance tests. No
server, API, permission, schema or migration change. Feather Dash can adopt it in its own change.

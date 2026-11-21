## Why

The bell, Recently Opened, Frequent and Saved Views were drawn only in the Admin. On Dash, Tasker and Tickets pages someone who can use the Admin lost their recall and their unread count (#1385, slice 2 of the shared sidebar).

## What Changes

- The shared top bar draws the notification bell at the top of every page's sidebar, the Admin's and every app's, with the same unread count and realtime refresh.
- An app's sidebar gets Recently Opened, Frequent and Saved Views below the app's own rows, drawn by the platform with the Admin's components, in the Admin's order. The Admin keeps its groups where they are.
- Each row opens by address: a full page load on an app's page, and the sign-in hand-off on an app's own address. A remembered record is a RecordLink.
- Someone who cannot use the Admin gets none of these groups on any page, nor the bell, and the page asks the server for none of them.
- The rail (collapsed sidebar) folds the groups as the Admin's do, in both frames.

## Capabilities

### New Capabilities

### Modified Capabilities

- `app-navigation`: every page's sidebar carries the platform's defaults.

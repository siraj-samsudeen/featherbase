## 1. Server

- [x] 1.1 Details, approve, decline and dismiss for one request, System Manager only; one activity row each; no mail. Verify `apps/server/test/access-request-decisions.test.ts`.
- [x] 1.2 A declined request is not counted, reminded or re-alerted, and the person is told it was declined (migration 0159). Verify `apps/server/test/access-request-decisions.test.ts`.
- [x] 1.3 `access.grant` in the app manifest; Dash 0.12.10 declares `grant_options` and `give_report`. Verify `client-apps/jeyarama/dash/platform-test/report-access.test.ts` (`npm run test:platform`).

## 2. Web

- [x] 2.1 The drawer beside the list, the Waiting and Declined views, and the declined message on the no-access pages. Verify `apps/web/test/access-request-drawer.test.tsx`.

## 1. Platform

- [x] 1.1 Share the leaver check's record rule, feed reader and feed refusal (tests unchanged and green)
- [x] 1.2 `left_status` on the roster settings, refused when it equals the current status (test)
- [x] 1.3 The status sync: rule cases, untouched rows, the limit and its override, a bad feed, a changed row, a failed save (tests)
- [x] 1.4 The roster run changes statuses first; the job refuses on either limit; the CLI's dry run, `--accept-status` and `--accept-ends` (tests)

- [x] 1.5 The attendance hold in the shared rule; the leaver check and its report's section 6 use it (tests, migration 0171)
- [x] 1.6 A left the roster link set is undone when the rule no longer says left, judged from the row's history (tests)

## 2. Dash

- [x] 2.1 `left_status: "Left"` in the instance settings

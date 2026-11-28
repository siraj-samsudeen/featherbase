## 1. A refused report says why

- [x] 1.1 Tests: a reader who reaches nothing gets `no_reach`; each refusal from either read shows its own message, never "couldn't open"; each refusal is one log line.
- [x] 1.2 Return `no_reach`, log `dash_report_refused`, show the messages (0.13.46 → 0.13.47).

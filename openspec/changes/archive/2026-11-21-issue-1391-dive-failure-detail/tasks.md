## 1. Which report failed

- [x] 1.1 Tests: a failed Dive's log line names the report and Dive, with MotherDuck's answer cut to 500 characters and every secret blanked.
- [x] 1.2 Log them in `embed_session` and `embed_open`.

## 2. A lost connection told apart

- [x] 2.1 Tests: no answer at all, or an unanswered session at the deadline, shows the connection message; an answer that refuses shows "couldn't open".
- [x] 2.2 Show the connection message with Try Again (0.13.45 → 0.13.46).

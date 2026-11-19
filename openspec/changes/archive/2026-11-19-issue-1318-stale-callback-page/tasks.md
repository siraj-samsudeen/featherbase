## 1. A stale or replayed callback lands on the sign-in page (#1318)

- [x] 1.1 The Google and Microsoft callbacks treat a caller as a page unless it is a browser fetch or asks for JSON
- [x] 1.2 Tests: Google and Microsoft callbacks opened with no cookie and no Accept go back with expired; a JSON caller and a browser fetch keep the 401; tests that play an API caller at a callback say they ask for JSON

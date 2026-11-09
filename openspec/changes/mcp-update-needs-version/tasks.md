## 1. Tests

- [x] 1.1 Scenarios "An agent's update of a row changed since it read it is refused" and "An agent's update without the version it read is refused", red first
- [x] 1.2 Server tests: `update_row` and `delete_row` without `updated_at` are refused, `query_rows` returns it, red first

## 2. Server

- [x] 2.1 `update_row` and `delete_row` require `updated_at`; `delete_row` passes it to the API; `query_rows` returns it by default; descriptions say so

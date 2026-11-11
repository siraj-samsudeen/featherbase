## 1. Refuse a source on an unsupported engine

- [ ] 1.1 Scenario test: a MySQL source saved before support ended is refused, naming MySQL and saying to delete it (fails first)
- [ ] 1.2 The source registry refuses an unsupported engine with that message

## 2. Remove MySQL

- [ ] 2.1 Remove the MySQL driver, `mysql2`, the `mysql` engine and its guidance, and the MySQL tests
- [ ] 2.2 A migration drops `mysql` from Data Source's engine choices and labels
- [ ] 2.3 The Connect Source page no longer offers MySQL
- [ ] 2.4 CI: drop the `mysql:8.4` service and `MYSQL_TEST_URL`; vitest config no longer special-cases the MySQL driver

## 3. Record and document

- [ ] 3.1 New ADR: MySQL is no longer a supported data source, superseding the MySQL provisions of ADRs 0007, 0012, 0016, 0017 and 0023
- [ ] 3.2 `docs/TESTING.md` and the `connect-an-outside-database` skill drop MySQL
- [ ] 3.3 Archive the change; drop MySQL from the external-data-sources Purpose

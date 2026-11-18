## 1. Platform

- [x] 1.1 `markDecidesScope` migration step, replayed both ways (tests)
- [x] 1.2 The scope-provider health check skips standard columns (test)

## 2. Dash

- [x] 2.1 businessAccess: one person's roles, places and Dash opening, shared by the scope provider, the reads and the comparison
- [x] 2.2 Reports under business roles: grants to a person or a business role (tests)
- [x] 2.3 The switch (dash.access_source), read fresh by the scope provider and every read; the old rules intact behind it (tests)
- [x] 2.4 Give Old Grants To Business Roles and Add The Starting Roles, each only when asked, logged and idempotent; the switch starts on the old rules (tests)
- [x] 2.5 Dash 0.13.30's version step and manifest; platform tests of the upgrade, each step, the switch and the switch back
- [x] 2.6 Business Roles page: what decides now, the Give Old Grants button, the log; Report access gives to a business role; Needs A Dash Role on the comparison

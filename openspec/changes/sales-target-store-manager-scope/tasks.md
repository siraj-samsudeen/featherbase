# Tasks

- [x] 1.1 Failing tests in `apps/server/test/sales-target.test.ts`: a Store Manager gets every material group of their store grouped by Section with basis `store_manager`; scope stops at their store; without the Table nothing is derived. Then derive `store_manager` in `derivedFromSections` and add the label to the report page; 37/37 green.
- [x] 1.2 The Store Manager Table and its rows ship in the data-warehouse `featherbase/apps/store-sections` app, loaded by `scripts/load_section_maps_to_featherbase.py`; Store Managers are provisioned as Users by `scripts/sync_report_viewers_to_featherbase.py`.

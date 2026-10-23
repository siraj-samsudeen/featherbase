-- data-warehouse #4344: the sales-target snapshot's material-group names, from the
-- merchandise hierarchy. A reader's list carries groups that had no target and no sale
-- this month; with no day row they had no name, and read "(name not in hierarchy)".
-- The day rows stop carrying a name: one name source, beside them, per snapshot.
-- App-internal like the rows table (0085): never reachable through the generic APIs.
-- A plain `create table` on purpose: a user Table squatting this name must fail (see 0071).
create table sales_target_snapshot_name (
  snapshot_id    text not null references dataset_snapshot(row_id) on delete cascade,
  hierarchy_code text not null,
  subcategory    text,
  primary key (snapshot_id, hierarchy_code)
);

alter table sales_target_snapshot_row drop column subcategory;

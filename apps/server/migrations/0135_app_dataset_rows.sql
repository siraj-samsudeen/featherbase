-- #625 (design E3): the rows of an app-declared cached dataset. One generic
-- relation for every app's datasets: each row is the declared columns,
-- shaped, as one JSON object, under the snapshot that `dataset_snapshot`
-- registers (dataset `<app>.<name>`).
--
-- Raw storage on purpose, like sales_target_snapshot_row (0085): never a
-- Table, so no list, document, export or report path can reach it. It holds
-- every place's rows; the only way out is the app's scope-checked read
-- (`context.datasets`), which applies the reader's places first.
-- No existing data is rewritten.
create table if not exists featherbase.app_dataset_row (
  snapshot_id text  not null references featherbase.dataset_snapshot(row_id) on delete cascade,
  row         jsonb not null
);

create index if not exists app_dataset_row_snapshot on featherbase.app_dataset_row (snapshot_id);

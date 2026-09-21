-- Package history belongs to the package, never to this core migration chain.
alter table installed_app
  add column package_version text,
  add column artifact_digest text,
  add column migration_ledger jsonb not null default '[]'::jsonb,
  add column activation_pending boolean not null default false,
  add column previous_artifact jsonb,
  add column upgrade_plan text;

update installed_app set package_version = manifest->>'packageVersion'
where runtime_package;

alter table installed_app add column enabled boolean not null default true;
alter table installed_app add column runtime_package boolean not null default false;

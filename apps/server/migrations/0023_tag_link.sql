-- UI-017: free-form tags on any document. A plain infra table keyed by the
-- document plus the tag string.
create table if not exists tag_link (
  ref_doctype varchar(140) not null,
  ref_name    varchar(140) not null,
  tag         varchar(140) not null,
  owner       varchar(140) not null default 'Administrator',
  creation    timestamptz not null default now(),
  primary key (ref_doctype, ref_name, tag)
);
create index if not exists tag_link_doc_idx on tag_link (ref_doctype, ref_name);

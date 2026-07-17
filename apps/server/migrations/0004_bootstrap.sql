-- META-012: DocType and DocField become DocTypes themselves. Their storage
-- moves to standard tab_* tables so the generic engine (meta, REST, list)
-- serves them like any other model. DocField is a child table of DocType.

alter table doctype rename to tab_doctype;
alter table docfield rename to tab_docfield;

alter table tab_doctype
  add column docstatus smallint not null default 0,
  add column idx integer not null default 0;

alter table tab_docfield
  add column owner varchar(140) not null default 'Administrator',
  add column creation timestamptz not null default now(),
  add column modified timestamptz not null default now(),
  add column modified_by varchar(140) not null default 'Administrator',
  add column docstatus smallint not null default 0,
  add column parenttype varchar(140) not null default 'DocType',
  add column parentfield varchar(140) not null default 'fields';

-- Meta rows describing DocType and DocField themselves (the bootstrap).
insert into tab_doctype (name, module, autoname, issingle, istable) values
  ('DocType', 'Core', 'prompt', false, false),
  ('DocField', 'Core', 'hash', false, true);

insert into tab_docfield (parent, idx, fieldname, label, fieldtype, options, reqd, in_list_view) values
  ('DocType', 1, 'module', 'Module', 'Data', null, false, true),
  ('DocType', 2, 'issingle', 'Is Single', 'Check', null, false, false),
  ('DocType', 3, 'istable', 'Is Child Table', 'Check', null, false, true),
  ('DocType', 4, 'is_submittable', 'Is Submittable', 'Check', null, false, false),
  ('DocType', 5, 'autoname', 'Autoname', 'Data', null, false, false),
  ('DocType', 6, 'title_field', 'Title Field', 'Data', null, false, false),
  ('DocType', 7, 'description', 'Description', 'Text', null, false, false),
  ('DocType', 8, 'fields', 'Fields', 'Table', 'DocField', false, false),
  ('DocField', 1, 'fieldname', 'Fieldname', 'Data', null, true, true),
  ('DocField', 2, 'label', 'Label', 'Data', null, false, true),
  ('DocField', 3, 'fieldtype', 'Field Type', 'Select', E'Data\nInt\nFloat\nCurrency\nCheck\nSelect\nDate\nDatetime\nText\nLong Text\nLink\nTable\nAttach\nJSON\nSection Break\nColumn Break', true, true),
  ('DocField', 4, 'options', 'Options', 'Text', null, false, false),
  ('DocField', 5, 'reqd', 'Required', 'Check', null, false, false),
  ('DocField', 6, 'unique', 'Unique', 'Check', null, false, false),
  ('DocField', 7, 'default_value', 'Default', 'Data', null, false, false),
  ('DocField', 8, 'read_only', 'Read Only', 'Check', null, false, false),
  ('DocField', 9, 'hidden', 'Hidden', 'Check', null, false, false),
  ('DocField', 10, 'in_list_view', 'In List View', 'Check', null, false, false),
  ('DocField', 11, 'permlevel', 'Perm Level', 'Int', null, false, false);

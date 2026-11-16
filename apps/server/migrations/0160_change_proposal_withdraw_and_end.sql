-- #1175: the maker can withdraw a pending proposal, and a proposal can end a row with nothing in
-- its place (a subcategory taken out of a section and left in none).
alter table featherbase.change_proposal add column if not exists ends_row boolean default false not null;

update featherbase.column_def set choices = 'Pending
Applied
Rejected
Needs fresh review
Withdrawn'
where parent = 'Change Proposal' and column_name = 'proposal_state' and choices not like '%Withdrawn%';

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'Change Proposal', 13, 'ends_row', 'Ends the row', 'Check', false, false, true, false, false, 'basic', 'Table', 'columns', false,
       'Approving ends the row and adds nothing in its place.'
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'ends_row');

-- #1286: a sixth, review-only section of Leavers Who Can Still Sign In: people
-- StyleHR says have left whom attendance shows at work since. Never a leaver.
alter table featherbase.leaver_sign_in drop constraint if exists leaver_sign_in_section_check;
alter table featherbase.leaver_sign_in add constraint leaver_sign_in_section_check
  check (section in ('1. Leaver job would disable', '2. System Manager: never disabled by the job',
    '3. Left, not on the leaver job''s list', '4. Not an employee, holds a StyleHR link', '5. Not on payroll, but no exit date',
    '6. At work, though StyleHR says they left'));

update featherbase.column_def
set choices = E'1. Leaver job would disable\n2. System Manager: never disabled by the job\n3. Left, not on the leaver job''s list\n4. Not an employee, holds a StyleHR link\n5. Not on payroll, but no exit date\n6. At work, though StyleHR says they left',
    description = 'Which part of the report: the leaver job''s own plan (1, 2), what the people app says (3, 4), or for review only (5, 6).'
where parent = 'Leaver Sign In' and column_name = 'section';

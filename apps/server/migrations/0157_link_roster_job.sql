-- #1157: the roster link, seeded OFF. An instance with a staff roster switches
-- it on in its settings (Dash does, in client-apps/jeyarama/instances/dash).
insert into featherbase.scheduled_job ("row_id", "created_by", "updated_by", "position", "method", "cadence", "enabled", "description", "problem_alert_queued")
values ('link_roster', 'Administrator', 'Administrator', 0, 'link_roster', 'hourly', false,
        'Give every current staff-roster row its person, sign-in link and employee code before they sign in, and end the link of anyone the roster no longer marks current. Never deletes a person; ends nothing when a run would end implausibly many links.', false)
on conflict ("row_id") do nothing;

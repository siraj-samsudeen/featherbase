-- Retired navigation pointers are reclaimed on event writes, across all history.
create index user_event_destination_row on featherbase.user_event ((destination->>'row'));

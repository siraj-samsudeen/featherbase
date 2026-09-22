-- Original scope is immutable with the result; only the authorization metadata
-- may be selected before a fresh policy decision permits result disclosure.
-- @spec action_writes_and_replay_are_atomic
alter table runtime_action_result add column "authorization" jsonb;

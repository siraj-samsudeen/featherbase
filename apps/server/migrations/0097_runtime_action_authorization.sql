-- Original scope is immutable with the result; only the authorization metadata
-- may be selected before a fresh policy decision permits result disclosure.
alter table runtime_action_result add column "authorization" jsonb;

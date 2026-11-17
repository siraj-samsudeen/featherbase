-- #1207 (mcp-oauth-connect): an agent signs in from the instance's agent
-- address alone, with the standard MCP authorization (OAuth 2.1). Only hashes
-- of codes, renewal keys and access tokens are stored.

-- A self-registered agent (RFC 7591): public, no secret.
create table if not exists featherbase.agent_client (
  id varchar(140) primary key,
  client_name varchar(140) not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

-- One Allow by a person. Live while not ended, used within 30 days, its person
-- enabled, and made after the person's sessions were last ended (D5, D10).
create table if not exists featherbase.agent_connection (
  id varchar(140) primary key,
  person varchar(140) not null references featherbase.person (row_id) on delete cascade,
  client_id varchar(140) not null references featherbase.agent_client (id) on delete cascade,
  client_name varchar(140) not null,
  -- 'loopback', or the https origin the agent returns to
  return_place text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text
);
create index if not exists agent_connection_person_ix on featherbase.agent_connection (person);

-- A sign-in code: single use, five minutes.
create table if not exists featherbase.agent_auth_code (
  code_hash char(64) primary key,
  client_id varchar(140) not null references featherbase.agent_client (id) on delete cascade,
  person varchar(140) not null references featherbase.person (row_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  return_place text not null,
  expires_at timestamptz not null
);

-- A renewal key: rotates on use; a late reuse ends the connection (D4).
create table if not exists featherbase.agent_refresh_token (
  token_hash char(64) primary key,
  connection_id varchar(140) not null references featherbase.agent_connection (id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists agent_refresh_token_connection_ix on featherbase.agent_refresh_token (connection_id);

-- A connection's short keys are ordinary access tokens tied to it (D2); null
-- for tokens made by hand.
alter table featherbase.access_token add column if not exists agent_connection varchar(140)
  references featherbase.agent_connection (id) on delete cascade;
create index if not exists access_token_agent_connection_ix on featherbase.access_token (agent_connection);

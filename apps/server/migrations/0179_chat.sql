-- ask-questions-of-app-data (chat): a person's conversations with an app's
-- chat panel, so they are there again on any device. A session is one
-- conversation; a message is what the person asked or what was answered, in
-- the mode it was asked in. An answer is kept as it was shown, figures
-- included, and only its owner can read it. closed_at is set when the owner
-- removes a session from their list; the rows are kept.
create table if not exists featherbase.chat_session (
  id bigint generated always as identity primary key,
  app text not null,
  owner text not null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists chat_session_open on featherbase.chat_session (app, owner, updated_at desc) where closed_at is null;
create table if not exists featherbase.chat_message (
  id bigint generated always as identity primary key,
  session bigint not null references featherbase.chat_session (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  mode text not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_message_session on featherbase.chat_message (session, id);

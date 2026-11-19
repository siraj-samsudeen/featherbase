-- ask-questions-of-app-data (action): a request a person made through an
-- app's chat for another person to review, such as a target review. The chat
-- only sends it; a reviewer approves or rejects it, and never their own. The
-- inputs are names and the person's own words, never a figure. A decision
-- records who made it, when, and their note; rows are kept.
create table if not exists featherbase.chat_request (
  id bigint generated always as identity primary key,
  app text not null,
  request text not null,
  prefix text not null,
  title text not null,
  requester text not null,
  session bigint references featherbase.chat_session (id) on delete set null,
  inputs jsonb not null,
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  note text
);
create index if not exists chat_request_pending on featherbase.chat_request (app, id) where status = 'pending_review';
create index if not exists chat_request_requester on featherbase.chat_request (app, requester, id desc);

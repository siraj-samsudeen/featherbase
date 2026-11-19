-- ask-questions-of-app-data: the questions a person has asked of an app's
-- figures, so a follow-up carries on from them on any device, and so what
-- people ask (and what could not be answered) can be seen later. A row holds
-- the question and the plan that answered it, the question asked back, or why
-- it was refused: never a figure. closed_at is set when the person starts
-- over; only rows still open are brought to a follow-up.
create table if not exists featherbase.app_question (
  id bigint generated always as identity primary key,
  app text not null,
  asker text not null,
  question text not null,
  model text,
  plan jsonb,
  clarify text,
  refused text,
  asked_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists app_question_open on featherbase.app_question (app, asker, asked_at desc) where closed_at is null;

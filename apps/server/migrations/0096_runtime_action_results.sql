-- Private durable command results, committed alongside the command's writes.
create table runtime_action_result (
  caller text not null,
  app text not null,
  action text not null,
  idempotency_key text not null,
  payload text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (caller, app, action, idempotency_key)
);
revoke all on runtime_action_result from public, app_client;

export const config = {
  port: Number(process.env.PORT ?? 8000),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://postgres:postgres@127.0.0.1:5432/featherbase',
  // API-008: origins allowed to call the API cross-origin (the Desk dev
  // server by default; comma-separated WEB_ORIGINS overrides).
  allowedOrigins: (
    process.env.WEB_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173'
  ).split(','),
}

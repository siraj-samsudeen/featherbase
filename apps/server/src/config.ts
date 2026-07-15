export const config = {
  port: Number(process.env.PORT ?? 8000),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://postgres:postgres@127.0.0.1:5432/frappe_clone',
}

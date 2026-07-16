import postgres from 'postgres'
import { config } from './config'

export const sql = postgres(config.databaseUrl, {
  onnotice: () => {},
  // META-004: schema sync ALTERs tables at runtime. Cached prepared
  // statements on warm pooled connections then fail with PG 0A000
  // ("cached plan must not change result type") on their next use, so
  // statement caching must stay off in a system that changes its own DDL.
  prepare: false,
})

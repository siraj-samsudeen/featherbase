// HARNESS-ONLY fault fixture. No Todo routes, title rules, filters or candidate implementation.
import http from 'node:http';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
if (process.argv[2] === 'migrate') {
  try {
    await client.query('BEGIN');
    await client.query('CREATE TABLE IF NOT EXISTS harness_counter (id integer PRIMARY KEY, value integer NOT NULL, version integer NOT NULL)');
    await client.query('INSERT INTO harness_counter VALUES (1, 0, 0) ON CONFLICT DO NOTHING');
    await client.query('CREATE TABLE IF NOT EXISTS harness_ledger (id integer PRIMARY KEY)');
    await client.query('INSERT INTO harness_ledger VALUES (1) ON CONFLICT DO NOTHING');
    if (process.env.PROBE_BUG === 'false-ledger') await client.query('COMMIT');
    if (process.env.PROBE_FAIL) throw new Error('Deliberate interrupted migration');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error.message);
    process.exitCode = 1;
  } finally { await client.end(); }
} else {
  const server = http.createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    try {
      if (request.url === '/') {
        response.setHeader('content-type', 'text/html');
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Harness-only transport probe</title><body><main><h1>Harness-only transport probe</h1><p>No Todo application is implemented here.</p><button>Send probe</button><p role="status">Idle</p><script>document.querySelector('button').onclick=async()=>{try{const r=await fetch('/probe',{method:'POST'});document.querySelector('[role=status]').textContent='Reply '+r.status}catch{document.querySelector('[role=status]').textContent='Reply lost'}}</script></main></body></html>`);
        return;
      }
      if (request.url === '/ready' && process.env.PROBE_BUG === 'false-ready') { response.end('{}'); return; }
      if (request.url === '/cas') {
        const result = await client.query(process.env.PROBE_BUG === 'overwrite'
          ? 'UPDATE harness_counter SET value=value+1, version=version+1 WHERE id=1 RETURNING *'
          : 'UPDATE harness_counter SET value=value+1, version=version+1 WHERE id=1 AND version=0 RETURNING *');
        response.statusCode = result.rowCount ? 200 : 409;
        response.end(JSON.stringify(result.rows));
        return;
      }
      if (request.method === 'POST' && request.url === '/probe') await client.query('UPDATE harness_counter SET value=value+1, version=version+1 WHERE id=1');
      const result = await client.query('SELECT * FROM harness_counter');
      response.end(JSON.stringify(result.rows));
    } catch (error) { response.statusCode = 503; response.end(JSON.stringify({ error: error.code || 'unavailable' })); }
  });
  server.listen(Number(process.env.PORT), '127.0.0.1');
  process.on('SIGTERM', () => server.close(async () => { await client.end(); process.exit(0); }));
}

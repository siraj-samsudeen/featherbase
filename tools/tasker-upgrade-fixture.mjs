// A package-only v2 proof artifact, never an application-specific core migration.
import { cp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function makeTaskerV2(source, destination) {
  await cp(source, destination, { recursive: true, filter: file => !file.split('/').includes('node_modules') })
  const file = resolve(destination, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  const pkg = JSON.parse(await readFile(resolve(destination, 'package.json'), 'utf8'))
  if (pkg.version !== '0.0.1') throw new Error('Tasker upgrade fixture requires preserved v1 (0.0.1) input')
  const column = { column_name: 'description', label: 'Description', column_type: 'Text' }
  manifest.tables.find(t => t.name === 'tasker.project').columns.push(column)
  manifest.migrations = [{ id: 'project_description', fromVersion: '0.0.1', toVersion: '2.0.0',
    operations: [{ kind: 'addColumn', table: 'tasker.project', column }] }]
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(resolve(destination, 'package.json'), JSON.stringify({ ...pkg, version: '2.0.0' }, null, 2) + '\n')
  // This fixture adapter models a v2 client without changing production Tasker UI.
  // The version is pinned to this artifact, never looked up per request.
  const index = resolve(destination, manifest.client, 'index.html')
  const html = await readFile(index, 'utf8')
  await writeFile(index, `<script>
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const request = new Request(new URL(typeof input === 'string' ? input : input.url, location.href), init);
      if (new URL(request.url).origin === location.origin && new URL(request.url).pathname.startsWith('/api/'))
        request.headers.set('X-Featherbase-App-Version', 'tasker@2.0.0');
      return originalFetch(request);
    };
  </script>\n` + html)
}

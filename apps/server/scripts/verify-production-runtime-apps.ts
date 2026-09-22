import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { artifactDigest } from '../src/artifact-digest'

export const PRODUCTION_RUNTIME_ARTIFACTS = [
  {
    name: 'tasker',
    path: '/app/runtime-apps/tasker/0.0.1',
    version: '0.0.1',
    digest: '39dcd5973c65f13e20a2432e70c7152092af84bac34b2669164e1093df61ba4e',
  },
  {
    name: 'tasker',
    path: '/app/runtime-apps/tasker/2.1.0',
    version: '2.1.0',
    digest: '14a8d23fe2ef59c58342433d2e56ecf0c3d00b1b6a0d1ca56192820c179c8f90',
  },
  {
    name: 'feather_dash',
    path: '/app/runtime-apps/feather_dash/0.1.3',
    version: '0.1.3',
    digest: '96e8a2b1110b5c2fde3609c3ccccc12ce69a8708d8ed06fac85539e534f38e5e',
  },
] as const

export async function verifyRuntimeArtifacts(
  artifacts: readonly { path: string; version: string; digest: string }[],
) {
  for (const artifact of artifacts) {
    const pkg = JSON.parse(await readFile(`${artifact.path}/package.json`, 'utf8'))
    if (pkg.version !== artifact.version)
      throw new Error(`${artifact.path} has package version ${pkg.version}, expected ${artifact.version}`)
    const digest = await artifactDigest(artifact.path)
    if (digest !== artifact.digest)
      throw new Error(`${artifact.path} has digest ${digest}, expected ${artifact.digest}`)
  }
}

async function main() {
  const configured = JSON.parse(process.env.FEATHERBASE_APP_PATHS ?? 'null')
  const expectedPaths = PRODUCTION_RUNTIME_ARTIFACTS.map(artifact => artifact.path)
  if (JSON.stringify(configured) !== JSON.stringify(expectedPaths))
    throw new Error(`FEATHERBASE_APP_PATHS must be ${JSON.stringify(expectedPaths)}`)
  await verifyRuntimeArtifacts(PRODUCTION_RUNTIME_ARTIFACTS)
  console.log(`verified production runtime artifacts: ${PRODUCTION_RUNTIME_ARTIFACTS.map(a => `${a.name}@${a.version} ${a.digest}`).join(', ')}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()

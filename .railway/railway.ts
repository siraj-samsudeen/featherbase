// The server's build and deploy settings on Railway, replacing railway.json
// (Railway stops reading Config as Code on 2026-12-01). Railway does not read
// this file when it deploys: the settings reach an environment only when
// `railway config plan` is reviewed and `railway config apply` run against it
// (docs/DEPLOY.md, "Railway").
//
// The named partial keeps this file to the one service it declares. Without
// it, an apply would delete every resource the file leaves out, the database
// included. Within the service, a setting the file leaves out is cleared, so
// the source and volume are declared too. Variables stay on Railway: secrets
// never go in source. Domains and regions are not touched by an omission and
// stay on the service.
import { defineRailway, github, project, service, volume } from 'railway/iac'

export const partial = 'featherbase-server'

// What differs between the environments this file is applied to, each read
// from Railway on 31-Oct-2026. An environment missing here is refused rather
// than guessed at. A volume's region and size are stated so an apply keeps them.
const ENVIRONMENTS: Record<string, {
  service: string
  volume: { name: string, region: string, sizeMB: number }
  watchPatterns?: string[]
}> = {
  production: {
    service: 'jeyarama-featherbase',
    volume: { name: 'jeyarama-featherbase-volume', region: 'asia-southeast1-eqsg3a', sizeMB: 50000 },
  },
  staging: {
    service: 'featherbase',
    volume: { name: 'featherbase-staging-data', region: 'sfo', sizeMB: 50000 },
    watchPatterns: [
      'apps/**', 'packages/**', 'pnpm-lock.yaml', 'tools/dev.mjs', 'tools/build-instance-apps.mjs',
      'client-apps/jeyarama/instances/dash/**', 'client-apps/jeyarama/dash/**', 'example-apps/tasker/**',
    ],
  },
}

export default defineRailway((ctx) => {
  const env = ENVIRONMENTS[ctx.environment ?? '']
  if (!env) throw new Error(`.railway/railway.ts has no settings for environment "${ctx.environment}"`)

  const data = volume(env.volume.name, { region: env.volume.region, sizeMB: env.volume.sizeMB })
  const server = service(env.service, {
    source: github('siraj-samsudeen/featherbase', { branch: 'main' }),
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'apps/server/Dockerfile',
      ...(env.watchPatterns ? { watchPatterns: env.watchPatterns } : {}),
    },
    // One command, never two chained with `&&`: Railway may run each entry as
    // argv, and the second was observed never to run while the deploy went
    // green (#307). pre-deploy.ts chains the steps instead.
    preDeploy: 'pnpm --filter server pre-deploy',
    healthcheck: '/api/ping',
    healthcheckTimeout: 300,
    deploy: { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 5 },
    volumeMounts: { '/data': data },
  })

  // Variables stay on Railway. The CLI reads `variables`, but the SDK's types
  // (railway 3.16.0) don't declare it yet, hence the spread.
  const unmanaged = { variables: { managed: false } }
  return project('jeyarama-featherbase', { ...unmanaged, resources: [server, data] })
})

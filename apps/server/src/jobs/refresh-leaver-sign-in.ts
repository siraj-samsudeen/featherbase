import { registerJob } from '../jobs'
import { LEAVER_SIGN_IN_JOB, refreshLeaverSignIn } from '../leaver-sign-in'

// #1271: rebuild Leavers Who Can Still Sign In. Daily (the Scheduled Job row,
// migration 0170), after each leaver check and roster sync, and on Refresh Now.
// It changes nobody.
registerJob(LEAVER_SIGN_IN_JOB, async (_payload, ctx) => {
  const rows = await refreshLeaverSignIn()
  ctx.setResult(`${rows} ${rows === 1 ? 'person' : 'people'} can still sign in`)
})

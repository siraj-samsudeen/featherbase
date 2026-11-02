import type { Context } from './server'

export async function prepareDiscussion(ctx: Context) {
  const { row, old } = ctx
  if (!String(row.body ?? '').trim()) ctx.reject('Write a message first')
  if (old) {
    if (old.created_by !== ctx.user) ctx.reject('Only the author can edit this message or resolve its question')
    for (const field of ['task', 'kind', 'parent_message'])
      if ((row[field] || null) !== (old[field] || null)) ctx.reject('A message stays with its original task and conversation')
  }
  row.reply_cycle = Number(old?.reply_cycle ?? 0) + (old?.resolved && !row.resolved ? 1 : 0)
  if (row.kind === 'Reply') {
    if (!row.parent_message) ctx.reject('Choose the message you are replying to')
    const root = await ctx.documents.get('tasker.discussion', String(row.parent_message))
    if (root.kind === 'Reply' || root.parent_message) ctx.reject('Reply to the original message, not another reply')
    row.reply_cycle = old ? old.reply_cycle : root.reply_cycle
    if (root.task !== row.task) ctx.reject('A reply must belong to the same task as its question')
    if (root.resolved && ctx.isNew) ctx.reject('Reopen this question before replying')
  } else if (row.parent_message) ctx.reject('Only a reply can name a parent message')
  if (row.kind !== 'Question' && (row.resolved || row.reply_needed_from))
    ctx.reject('Only questions have a respondent and resolution')
  if (row.reply_needed_from && (!old || row.reply_needed_from !== old.reply_needed_from)) {
    const members = await ctx.documents.members('tasker.discussion')
    if (!members.some(member => member.row_id === row.reply_needed_from)) ctx.reject('Choose a current team member or Anyone')
  }
  // Root before task: question edits and replies acquire shared locks in the same order.
  await ctx.documents.get('tasker.task', String(row.task))
  if (ctx.isNew && row.resolved) ctx.reject('A new question starts waiting for a reply')
}

// src/actions.ts
function input(ctx) {
  const value = ctx.payload;
  if (!value || typeof value !== "object" || typeof value.row_id !== "string" || !value.row_id || typeof value.updated_at !== "string" || !value.updated_at || value.confirm !== void 0 && typeof value.confirm !== "boolean")
    ctx.reject("Choose a task and its current revision");
  return value;
}
var actions = {
  async promote(ctx) {
    const request = input(ctx);
    const task = await ctx.documents.get("tasker.task", request.row_id);
    if (String(task.updated_at) !== request.updated_at) ctx.reject("This task changed. Close and reopen its details before promoting.");
    const counts = await ctx.documents.deletionState("tasker.task", request.row_id);
    const rich = Boolean(task.assigned_to || task.urgent || task.is_done || task.task_state !== "Not started" || counts.comments || counts.versions || counts.references || counts.files || counts.shares);
    if (rich && !request.confirm) return { confirmationRequired: true };
    const project = await ctx.documents.create("tasker.project", {
      project_name: task.task_title,
      description: task.description ?? null
    });
    if (rich) {
      const moved = await ctx.documents.update("tasker.task", {
        row_id: request.row_id,
        updated_at: request.updated_at,
        project: project.row_id,
        personal_tasks_owner: null,
        assigned_to: task.assigned_to
      });
      if (task.personal_tasks_owner && task.assigned_to) await ctx.documents.update("tasker.task", {
        row_id: request.row_id,
        updated_at: moved.updated_at,
        assigned_to: task.assigned_to
      });
    } else await ctx.documents.delete("tasker.task", request.row_id, request.updated_at);
    return { projectId: String(project.row_id), retainedTask: rich };
  },
  async delete_accidental(ctx) {
    const request = input(ctx);
    if (!request.confirm) ctx.reject("Confirm permanent deletion of this accidental task");
    const task = await ctx.documents.get("tasker.task", request.row_id);
    if (String(task.updated_at) !== request.updated_at) ctx.reject("This task changed. Close and reopen its details before deleting.");
    const counts = await ctx.documents.deletionState("tasker.task", request.row_id);
    if (counts.comments || counts.versions || counts.references || counts.files || counts.shares || task.assigned_to || task.urgent || task.task_state !== "Not started")
      return { deleted: false, message: "This task has retained work, references, attachments or shared access. Choose Cancelled to keep its context.", counts };
    await ctx.documents.delete("tasker.task", request.row_id, request.updated_at);
    return { deleted: true };
  }
};

// src/server.ts
var apiVersion = 1;
var validators = { "tasker.task": prepareTask };
function prepareTask(ctx) {
  if (ctx.row.project && ctx.row.personal_tasks_owner)
    ctx.reject("Choose either a project or Personal tasks, not both", {
      personal_tasks_owner: "Remove the project before choosing Personal tasks"
    });
  if (ctx.row.personal_tasks_owner)
    ctx.row.assigned_to = ctx.row.personal_tasks_owner;
  else if (ctx.old?.personal_tasks_owner && ctx.row.assigned_to === ctx.old.personal_tasks_owner)
    ctx.row.assigned_to = null;
  const oldDone = Boolean(ctx.old?.is_done);
  const nextDone = Boolean(ctx.row.is_done);
  const oldState = String(ctx.old?.task_state ?? "Not started");
  const nextState = String(ctx.row.task_state ?? "Not started");
  const doneChanged = nextDone !== oldDone;
  const stateChanged = nextState !== oldState;
  if (doneChanged && nextDone) {
    ctx.row.state_before_done = nextState === "Done" ? oldState : nextState;
    ctx.row.task_state = "Done";
  } else if (doneChanged) {
    ctx.row.task_state = stateChanged ? nextState : String(ctx.old?.state_before_done ?? "Not started");
    ctx.row.state_before_done = null;
  } else if (stateChanged && nextState === "Done") {
    ctx.row.is_done = true;
    ctx.row.state_before_done = oldState;
  } else if (stateChanged) {
    ctx.row.is_done = false;
    ctx.row.state_before_done = null;
  }
}
export {
  actions,
  apiVersion,
  validators
};

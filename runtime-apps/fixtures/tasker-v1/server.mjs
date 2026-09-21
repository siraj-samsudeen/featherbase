const apiVersion = 1;
const validators = { "tasker.task": prepareTask };
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
  apiVersion,
  validators
};

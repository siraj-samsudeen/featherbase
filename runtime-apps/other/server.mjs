export const apiVersion = 1
export const validators = {
  'other.task'(ctx) {
    if (Number(ctx.row.quantity) <= 0)
      ctx.reject('Quantity must be positive', { quantity: 'Must be positive' })
    ctx.row.validation_runs = Number(ctx.old?.validation_runs ?? 0) + 1
  },
}

export function hashTaskId() {
  return new URLSearchParams(location.hash.slice(1)).get('task')
}

export function hashSavedViewId() {
  return new URLSearchParams(location.hash.slice(1)).get('view')
}

export function savedViewHash(viewId: string, taskId?: string) {
  const params = new URLSearchParams({ view: viewId })
  if (taskId) params.set('task', taskId)
  return `#${params}`
}

export function sameDocumentHash(hash: string) {
  return `${location.pathname}${location.search}${hash}`
}

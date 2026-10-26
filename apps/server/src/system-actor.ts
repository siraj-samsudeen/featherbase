// A named actor the server itself writes as (instance-settings D4): the saves
// an apply makes are recorded as `instance-settings`, not as whoever sent the
// file. That name is not a person or a service account, so it holds the System
// Manager role only inside the operation that runs as it. A person who somehow
// carried the same id would get nothing from it outside that scope.
import { AsyncLocalStorage } from 'node:async_hooks'

const acting = new AsyncLocalStorage<string>()

export function runAsSystemActor<T>(actor: string, fn: () => Promise<T>): Promise<T> {
  return acting.run(actor, fn)
}

/** True while `principal` is the actor the current operation runs as. */
export function isActingSystemActor(principal: string): boolean {
  return acting.getStore() === principal
}

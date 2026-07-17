// A fluent, chainable Session DSL for driving a rendered UI in tests —
// Phoenix/Wallaby-flavored, implemented on @testing-library/dom +
// user-event. Methods queue actions and return `this`; awaiting the session
// executes the queue sequentially. On failure the error shows the whole
// chain with the failing step marked.
//
//   await session
//     .fillIn('Title', 'Sales mismatch')
//     .clickButton('Save')
//     .assertText('TICK-')

import {
  prettyDOM,
  waitFor,
  within as tlWithin,
} from '@testing-library/dom'
import userEvent from '@testing-library/user-event'

type UserApi = ReturnType<typeof userEvent.setup>

interface Step {
  label: string
  run: () => Promise<void>
  status: 'pending' | 'ok' | 'failed' | 'skipped'
}

export interface SessionOptions {
  root?: HTMLElement
  /** Per-lookup timeout in ms (default 3000). */
  timeout?: number
}

const j = (s: unknown) => JSON.stringify(s)

function isVisibleControl(el: Element): boolean {
  return el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
}

export class Session {
  private steps: Step[] = []
  private user: UserApi
  private rootEl: () => HTMLElement
  private timeout: number
  private lastControl: Element | null = null

  constructor(opts: SessionOptions = {}) {
    this.user = userEvent.setup()
    this.rootEl = () => opts.root ?? document.body
    this.timeout = opts.timeout ?? 3000
  }

  // ---- element lookup ------------------------------------------------------

  private q() {
    return tlWithin(this.rootEl())
  }

  private async find<T extends Element>(describe: string, get: () => T | null): Promise<T> {
    try {
      return await waitFor(
        () => {
          const el = get()
          if (!el) throw new Error(`Could not find ${describe}`)
          return el
        },
        { timeout: this.timeout, container: this.rootEl() },
      )
    } catch (e) {
      throw new Error(`Could not find ${describe}`, { cause: e })
    }
  }

  /** Label text → its form control. Handles htmlFor-associated labels AND
   * the common "label and input are siblings in a wrapper div" layout. */
  private findControl(label: string): Promise<HTMLElement> {
    return this.find(`a field labelled ${j(label)}`, () => {
      const root = this.rootEl()
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
      for (const l of Array.from(root.querySelectorAll('label'))) {
        const text = norm(l.textContent)?.replace(/\s*\*$/, '')
        if (text !== label) continue
        if (l instanceof HTMLLabelElement && l.control) return l.control
        // control nested inside the label
        const nested = l.querySelector('input, textarea, select')
        if (nested && isVisibleControl(nested)) return nested as HTMLElement
        // control as a sibling within the same wrapper
        const sibling = l.parentElement?.querySelector('input, textarea, select')
        if (sibling && isVisibleControl(sibling)) return sibling as HTMLElement
      }
      // placeholder fallback
      const byPlaceholder = root.querySelector(`[placeholder=${JSON.stringify(label)}]`)
      if (byPlaceholder) return byPlaceholder as HTMLElement
      return null
    })
  }

  // ---- chain plumbing ------------------------------------------------------

  private push(label: string, run: () => Promise<void>): this {
    this.steps.push({ label, run, status: 'pending' })
    return this
  }

  /** Awaiting the session executes the queued steps in order. The queue
   * resets afterwards so the same session can run further chains.
   *
   * Resolves with `undefined` — NEVER with `this`: a thenable that resolves
   * to itself makes `await` recurse forever (the promise resolution
   * procedure keeps re-awaiting the thenable). */
  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const steps = this.steps
    this.steps = []
    const execute = async (): Promise<void> => {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        try {
          await step.run()
          step.status = 'ok'
        } catch (cause) {
          step.status = 'failed'
          for (let k = i + 1; k < steps.length; k++) steps[k].status = 'skipped'
          throw this.chainError(steps, i, cause)
        }
      }
    }
    return execute().then(onfulfilled, onrejected)
  }

  private chainError(steps: Step[], failedIndex: number, cause: unknown): Error {
    const causeMsg = cause instanceof Error ? cause.message : String(cause)
    const lines = steps.map((s) => {
      if (s.status === 'failed') return `>>> [FAILED] ${s.label}`
      return `    [${s.status === 'ok' ? 'ok' : 'skipped'}] ${s.label}`
    })
    const err = new Error(
      `feather-testing-postgres: step ${failedIndex + 1} of ${steps.length} failed\n\n` +
        `Failed at: ${steps[failedIndex].label}\n` +
        `Cause: ${causeMsg.split('\n')[0]}\n\n` +
        `Chain:\n${lines.join('\n')}`,
    )
    err.cause = cause
    return err
  }

  // ---- interactions --------------------------------------------------------

  fillIn(label: string, value: string | number): this {
    return this.push(`fillIn(${j(label)}, ${j(value)})`, async () => {
      const el = await this.findControl(label)
      this.lastControl = el
      await this.user.clear(el)
      const text = String(value)
      if (text) await this.user.type(el, text)
    })
  }

  selectOption(label: string, option: string): this {
    return this.push(`selectOption(${j(label)}, ${j(option)})`, async () => {
      const el = await this.findControl(label)
      if (!(el instanceof HTMLSelectElement))
        throw new Error(`Field ${j(label)} is not a <select>`)
      this.lastControl = el
      const opt = Array.from(el.options).find(
        (o) => o.textContent?.trim() === option || o.value === option,
      )
      if (!opt) {
        const available = Array.from(el.options).map((o) => o.textContent?.trim())
        throw new Error(`No option ${j(option)} in ${j(label)} (has: ${available.join(', ')})`)
      }
      await this.user.selectOptions(el, opt)
    })
  }

  private setChecked(label: string, want: boolean, verb: string): this {
    return this.push(`${verb}(${j(label)})`, async () => {
      const el = await this.findControl(label)
      if (!(el instanceof HTMLInputElement)) throw new Error(`Field ${j(label)} is not an input`)
      this.lastControl = el
      if (el.checked !== want) await this.user.click(el)
    })
  }

  check(label: string): this {
    return this.setChecked(label, true, 'check')
  }

  uncheck(label: string): this {
    return this.setChecked(label, false, 'uncheck')
  }

  choose(label: string): this {
    return this.setChecked(label, true, 'choose')
  }

  clickButton(name: string): this {
    return this.push(`clickButton(${j(name)})`, async () => {
      const el = await this.find(`a button ${j(name)}`, () => {
        const buttons = Array.from(
          this.rootEl().querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]'),
        )
        return (
          buttons.find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === name) ??
          buttons.find((b) => (b.textContent ?? '').includes(name)) ??
          null
        )
      })
      await this.user.click(el)
    })
  }

  clickLink(name: string): this {
    return this.push(`clickLink(${j(name)})`, async () => {
      const el = await this.find(`a link ${j(name)}`, () => {
        const links = Array.from(this.rootEl().querySelectorAll<HTMLElement>('a'))
        return (
          links.find((a) => (a.textContent ?? '').replace(/\s+/g, ' ').trim() === name) ??
          links.find((a) => (a.textContent ?? '').includes(name)) ??
          null
        )
      })
      await this.user.click(el)
    })
  }

  click(text: string): this {
    return this.push(`click(${j(text)})`, async () => {
      const el = await this.find(`an element with text ${j(text)}`, () => {
        const all = Array.from(this.rootEl().querySelectorAll<HTMLElement>('*'))
        // innermost element whose own text matches
        const matches = all.filter((n) => {
          const own = (n.textContent ?? '').replace(/\s+/g, ' ').trim()
          return own === text || own.includes(text)
        })
        return matches.length ? matches[matches.length - 1] : null
      })
      await this.user.click(el)
    })
  }

  submit(): this {
    return this.push('submit()', async () => {
      const form =
        (this.lastControl?.closest('form') as HTMLFormElement | null) ??
        this.rootEl().querySelector('form')
      if (!form) throw new Error('No form to submit')
      form.requestSubmit()
    })
  }

  // ---- assertions ----------------------------------------------------------

  assertText(text: string): this {
    return this.push(`assertText(${j(text)})`, async () => {
      await waitFor(
        () => {
          const content = this.rootEl().textContent ?? ''
          if (!content.includes(text)) throw new Error(`Text ${j(text)} not found on the page`)
        },
        { timeout: this.timeout, container: this.rootEl() },
      )
    })
  }

  refuteText(text: string): this {
    return this.push(`refuteText(${j(text)})`, async () => {
      // Let pending renders settle, then require absence.
      await new Promise((r) => setTimeout(r, 50))
      const content = this.rootEl().textContent ?? ''
      if (content.includes(text)) throw new Error(`Text ${j(text)} IS on the page but should not be`)
    })
  }

  // ---- scoping & debugging -------------------------------------------------

  within(selector: string, fn: (s: Session) => Session | Promise<unknown>): this {
    return this.push(`within(${j(selector)}, ...)`, async () => {
      const scopeEl = await this.find(`an element matching ${j(selector)}`, () =>
        this.rootEl().querySelector<HTMLElement>(selector),
      )
      const scoped = new Session({ root: scopeEl, timeout: this.timeout })
      scoped.user = this.user
      await fn(scoped)
    })
  }

  debug(): this {
    return this.push('debug()', async () => {
      // eslint-disable-next-line no-console
      console.log(prettyDOM(this.rootEl(), 20000))
    })
  }
}

export function createSession(opts: SessionOptions = {}): Session {
  return new Session(opts)
}

// The month's allowance for the language model: use is kept call by call,
// the server log is warned at 80%, and at 100% questions in words are refused
// until the month ends.
import { afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { overrideVariable } from '../src/env'
import { assertAllowance, monthlyAllowance, recordUsage, reopens, usageReport, usedThisMonth } from '../src/model-usage'

afterEach(() => overrideVariable('ANALYST_MONTHLY_TOKENS', undefined))

describe('the month\'s allowance for the language model', () => {
  test('with no allowance set, use is kept and nothing is refused', async () => {
    expect(monthlyAllowance()).toBeUndefined()
    await recordUsage('claude-test', 900, 100)
    await assertAllowance()
    expect(await usedThisMonth()).toBe(1000)
    expect(await usageReport()).toEqual({ used: 1000, calls: 1, allowance: null, reopens: reopens(), state: 'no allowance' })
    for (const unset of ['', '0', '-5', 'plenty']) {
      overrideVariable('ANALYST_MONTHLY_TOKENS', unset)
      expect(monthlyAllowance()).toBeUndefined()
    }
  })

  test('the log is warned at 80% and again when the allowance is used up, and then questions are refused', async () => {
    overrideVariable('ANALYST_MONTHLY_TOKENS', ' 1000.9 ')
    expect(monthlyAllowance()).toBe(1000)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await recordUsage('claude-test', 500, 100)
    expect(warn).not.toHaveBeenCalled()
    expect((await usageReport()).state).toBe('open')
    await recordUsage('claude-test', 150, 50)
    expect(warn).toHaveBeenLastCalledWith('[analyst] 80% of this month\'s allowance of 1000 tokens is used')
    expect((await usageReport()).state).toBe('warning')
    await assertAllowance()
    await recordUsage('claude-test', 150, 60)
    expect(warn).toHaveBeenLastCalledWith(`[analyst] this month's allowance of 1000 tokens is used up: questions in words are refused until ${reopens()}`)
    expect(warn).toHaveBeenCalledTimes(2)
    // Past the allowance already: nothing more to warn of.
    await recordUsage('claude-test', 1, 1)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
    expect(await usageReport()).toMatchObject({ used: 1012, calls: 4, allowance: 1000, state: 'stopped' })
    await expect(assertAllowance()).rejects.toMatchObject({ type: 'RateLimitError', message: `This month's allowance for questions in words is used up. It opens again on ${reopens()}.` })
  })

  test('last month\'s use does not count, so the month opens again by itself', async () => {
    overrideVariable('ANALYST_MONTHLY_TOKENS', '1000')
    await sql`insert into model_usage (at, model, input_tokens, output_tokens) values (date_trunc('month', now()) - interval '1 second', 'claude-test', 5000, 5000)`
    expect(await usedThisMonth()).toBe(0)
    await assertAllowance()
  })

  test('the day it opens again is the first of next month', () => {
    expect(reopens(new Date('2026-11-17T08:00:00Z'))).toBe('1 December')
    expect(reopens(new Date('2026-12-31T23:59:59Z'))).toBe('1 January')
  })

  test('use that cannot be kept is logged and never fails the answer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await recordUsage('claude-test', Number.NaN, 1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[analyst] usage was not recorded:'))
    warn.mockRestore()
  })
})

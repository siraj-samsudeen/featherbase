// How an answer to a question is drawn: the report's own figures and wording.
import { describe, expect, it } from 'vitest'
import manifest from '../featherbase.json' with { type: 'json' }
import { ApiError } from './api'
import { SUGGESTIONS, answerDataLine, askFailure, cell, columnLabel, coversLine, definitionLines, unmatchedLine, type AskColumn, type AskResult } from './ask'

const [model, byMonth] = manifest.semantic.models
const column = (name: string, kind: AskColumn['kind'] = 'measure', unit?: 'percent'): AskColumn => ({ name, kind, ...(unit ? { unit } : {}) })

describe('the questions to start from', () => {
  it("are verified questions of the app's models, which the language model is known to answer", () => {
    expect(SUGGESTIONS).toEqual([...model.verified.map(v => v.question), byMonth.verified[0].question])
  })
})

describe('a column heading', () => {
  it("is the report's word for every part of the model", () => {
    const names = [...model.dimensions, ...model.measures, ...model.metrics].map(part => part.name)
    for (const name of names) expect(columnLabel(name)).not.toContain('_')
    expect(names.map(columnLabel)).toEqual(['Store', 'Subcategory', 'Section', 'Department', 'Target', 'Sales', 'Target quantity', 'Sales quantity', 'Gap', 'Achieved'])
  })

  it('is the name in plain words for a part added later', () => {
    expect(columnLabel('days_with_sales')).toBe('Days with sales')
  })
})

describe('a figure', () => {
  it('is drawn as the report draws it', () => {
    expect(cell(column('target'), 1250000.49)).toEqual({ text: '₹12,50,000.49', numeric: true, negative: false })
    expect(cell(column('gap', 'metric'), -240000)).toEqual({ text: '−₹2,40,000.00', numeric: true, negative: true })
    expect(cell(column('gap', 'metric'), 2500)).toEqual({ text: '+₹2,500.00', numeric: true, negative: false })
    // This month beside last month: rupees for each month, and the change with its sign.
    expect(cell(column('sales_last_month'), 1703451.6).text).toBe('₹17,03,451.60')
    expect(cell(column('sales_change', 'metric'), -1500)).toEqual({ text: '−₹1,500.00', numeric: true, negative: true })
    expect(['month', 'sales_last_month', 'sales_change', 'sales_growth', 'month_sales'].map(columnLabel)).toEqual(['Month', 'Sales last month', 'Change', 'Growth', 'Sales'])
    expect(cell(column('achieved', 'metric', 'percent'), 79.919039)).toEqual({ text: '79.9%', numeric: true, negative: false })
    expect(cell(column('sales_quantity'), 12.5)).toEqual({ text: '12.5', numeric: true, negative: false })
  })

  it('that is missing is a dash, never zero', () => {
    expect(cell(column('achieved', 'metric', 'percent'), null).text).toBe('—')
    // A row with no store or section names that, not a bare dash; any other blank name is a dash.
    expect(cell(column('store', 'dimension'), null).text).toBe('No store')
    expect(cell(column('section', 'dimension'), null).text).toBe('No section')
    expect(cell(column('month', 'dimension'), null).text).toBe('No month')
    expect(cell(column('colour', 'dimension'), null).text).toBe('—')
    // A percentage the SQL worked out is written as one.
    expect(cell({ ...column('sales_share'), unit: 'percent' }, 74.668).text).toBe(cell(column('achieved', 'metric', 'percent'), 74.668).text)
  })

  it('a name is shown as it is', () => {
    expect(cell(column('subcategory', 'dimension'), 'Silk sarees')).toEqual({ text: 'Silk sarees', numeric: false, negative: false })
  })
})

describe('what an answer says about itself', () => {
  it('how recent the figures are', () => {
    expect(answerDataLine({ asOf: '2026-11-14', at: '2026-11-15T00:19:00.000Z' })).toBe('Data to 14-Nov-2026 · refreshed 05:49 IST')
    expect(answerDataLine({ at: null })).toBe('Data to — · refreshed —')
  })

  it('whose figures it counted, counting a long list', () => {
    expect(coversLine(['9901 / Section: Sarees'])).toBe('Covers: 9901 / Section: Sarees')
    expect(coversLine(['a', 'b', 'c', 'd'])).toBe('Covers your 4 stores and sections')
  })

  it('a name that matched nothing', () => {
    expect(unmatchedLine({ dimension: 'subcategory', value: 'Wrist watches' })).toBe('“Wrist watches” is not one of your subcategories, so nothing matched it.')
    expect(unmatchedLine({ dimension: 'store', value: 'West' })).toBe('“West” is not one of your stores, so nothing matched it.')
    expect(unmatchedLine({ dimension: 'floor', value: '3' })).toBe('“3” is not one of your floor names, so nothing matched it.')
  })

  it('how each figure was worked out', () => {
    expect(definitionLines([column('subcategory', 'dimension'), { ...column('gap', 'metric'), definition: 'sales - target' }])).toEqual(['Gap: sales - target'])
  })
})

describe('a refused question', () => {
  it.each([
    [401, 'Sign in again to ask a question.'],
    [403, "You don't have access to ask about any store yet."],
    [429, 'Too many questions just now. Try again in a minute.'],
    [409, 'from the platform'], [417, 'from the platform'], [503, 'from the platform'],
    [500, "That question couldn't be answered. Try again."],
  ])('with status %i says %j', (status, message) => {
    expect(askFailure(new ApiError('from the platform', status))).toBe(message)
  })

  it('for any other failure says to try again', () => {
    expect(askFailure(new TypeError('network'))).toBe("That question couldn't be answered. Try again.")
  })
})

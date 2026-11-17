import { describe, expect, it } from 'vitest'
import { andList, mentionsRemoved, sectionsName } from './department-name.ts'
import { sectionsName as loadersName } from './department-prefill.ts'

describe('department names (#1205, #1209)', () => {
  it('are the same rule for the load and the form', () => {
    expect(loadersName).toBe(sectionsName)
    expect(sectionsName([])).toBe('')
  })
  it('finds a taken-out section a name mentions: whole words, any case, in name order', () => {
    expect(mentionsRemoved('Kurti, Women Bottoms & Women Ethnic Sets', ['Women Bottoms'])).toEqual(['Women Bottoms'])
    expect(mentionsRemoved('silk corner', ['Silk'])).toEqual(['Silk'])
    expect(mentionsRemoved('Silky Corner', ['Silk'])).toEqual([])
    expect(mentionsRemoved('Sarees and Silk', ['Silk', 'Sarees', 'Bags'])).toEqual(['Sarees', 'Silk'])
    expect(mentionsRemoved('Bag / Luggage (Kids)', ['Bag / Luggage', '(Kids)'])).toEqual(['(Kids)', 'Bag / Luggage'])
    expect(mentionsRemoved('Ladies', [])).toEqual([])
  })
  it('lists names as people say them', () => {
    expect(andList([])).toBe('')
    expect(andList(['Silk'])).toBe('Silk')
    expect(andList(['Sarees', 'Silk'])).toBe('Sarees and Silk')
    expect(andList(['Bags', 'Sarees', 'Silk'])).toBe('Bags, Sarees and Silk')
  })
})

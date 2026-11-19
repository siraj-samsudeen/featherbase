// #1330: a Scheduled Job reads by its title, never its code ("check_sla").
import { expect } from 'vitest'
import { sql } from '../src/db'
import { test } from './pg-test'

test("the Scheduled Job Table's title is its Title column", async () => {
  const [def] = await sql`select title_column from table_def where name = 'Scheduled Job'`
  expect(def.title_column).toBe('title')
  const [column] = await sql`select label, column_type from column_def where parent = 'Scheduled Job' and column_name = 'title'`
  expect(column).toMatchObject({ label: 'Title', column_type: 'Data' })
})

test("every platform job has a Title Case title, not its code", async () => {
  const jobs = await sql`select method, title from scheduled_job where owner_app is null order by method`
  expect(jobs.length).toBeGreaterThan(0)
  for (const job of jobs) {
    expect(job.title, job.method).toBeTruthy()
    expect(job.title, job.method).not.toBe(job.method)
    // Each word starts with a capital, except the small joining words.
    for (const word of String(job.title).split(' '))
      if (!['a', 'an', 'and', 'for', 'of', 'the', 'to', 'about'].includes(word)) expect(word[0], `${job.method}: ${job.title}`).toMatch(/[A-Z0-9]/)
  }
  expect(jobs.find((j) => j.method === 'check_instance_health')?.title).toBe('Check Instance Health')
})

// asset-labels's scenarios (#1070): each test is one fenced scenario of
// openspec/specs/asset-labels/spec.md, step by step, with the Assets app
// rendered in jsdom against the real in-process server.
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, screenSession } from '../pg-test'
import { Assets, realTime } from './assets'

const scenario = scenarioFor(test, 'asset-labels')
afterEach(realTime)

describe('asset-labels', () => {
  scenario('Labels for part of a roll', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let labels: { name: string | null; text: string; qr: number }[] = []
    await step('roll R-03 holds tags JRA-000301 to JRA-000400', () =>
      assets.setupRow('equipment.tag_roll', { roll_name: 'R-03', first_no: 301, last_no: 400 }))
    await step('the user prints labels from JRA-000301 to JRA-000306', async () => {
      await assets.open('the user', 'labels')
      await screenSession().fillIn('From', 'JRA-000301').fillIn('To', 'JRA-000306')
      const sheet = await screen.findByRole('region', { name: 'Label sheet' })
      expect(screen.getByRole('button', { name: 'Print labels' })).toBeEnabled()
      await waitFor(() => expect(within(sheet).getAllByRole('article')[0]!.querySelector('[role="img"][aria-label^="QR code for"] svg')).not.toBeNull())
      labels = within(sheet).getAllByRole('article').map(label => ({
        name: label.getAttribute('aria-label'),
        text: label.textContent!,
        qr: within(label).getAllByRole('img', { name: /QR code for/ }).filter(img => img.querySelector('svg')).length,
      }))
    })
    await step('the sheet has six labels, JRA-000301 to JRA-000306', () =>
      expect(labels.map(label => label.name)).toEqual(Array.from({ length: 6 }, (_, index) => `Label JRA-${String(301 + index).padStart(6, '0')}`)))
    await step('each label reads "Jeyarama Group property" and "Please do not remove" and has a QR code', () => {
      for (const label of labels) {
        expect(label.text, String(label.name)).toMatch(/Jeyarama Group property/)
        expect(label.text, String(label.name)).toMatch(/Please do not remove/)
        expect(label.qr, `${label.name} has no QR code`).toBe(1)
      }
    })
  })

  scenario('Scan a label', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let main: HTMLElement
    await step('the "Voltas 2-ton split AC" carries tag JRA-000301', async () => {
      const id = await assets.asset('Voltas 2-ton split AC', 'ATK 1501', { type: 'AC', warranty_until: '2027-03-12', tag_no: 'JRA-000301' })
      expect(Number(String((await assets.get('equipment.asset', id)).tag_no).replace('JRA-', ''))).toBe(301)
      await assets.setupRow('equipment.job', { asset: id, problem: 'Not cooling' })
    })
    await step('a member scans its label with a phone', async () => {
      // The label's QR code holds this address (tagAddress in Tagging.tsx); it opens the asset with that tag.
      main = await assets.open('a member', `tag=${encodeURIComponent('JRA-000301')}`)
      await screen.findByRole('heading', { name: 'Voltas 2-ton split AC' })
    })
    await step("the AC's page opens, with its place, warranty and any open repair job", async () => {
      await waitFor(() => expect(main.textContent).toMatch(/Not cooling/))
      expect(main.textContent).toMatch(/Voltas 2-ton split AC/)
      expect(main.textContent).toMatch(/ATK 1501/)
      expect(main.textContent).toMatch(/12-Mar-2027/)
    })
  })
})

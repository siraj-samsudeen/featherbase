import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { ParsedSheet } from '../lib/parse-file'
import { ImportOverview, type GroupMode } from './ImportOverview'

// A made-up workbook of store sales: a sheet per store, a lookup, a scratch sheet.
const STORE_HEADERS = ['Bill date', 'Bill no', 'Section', 'Subcategory', 'Brand', 'Pieces', 'Net amount', 'Salesperson']
const rows = (n: number) => Array.from({ length: n }, (_, i) => [`0${(i % 9) + 1}-Oct-2026`, `B-${1000 + i}`, 'Menswear', 'Men Casual Shirt', 'Peter England', 1, 1299, 'Ravi Kumar'])
const sheet = (sheetName: string, n: number, visibility: ParsedSheet['visibility'] = 'visible', headers = STORE_HEADERS): ParsedSheet =>
  ({ sheetName, headers, rows: rows(n), headerExcelRow: 1, visibility })

const WORKBOOK: ParsedSheet[] = [
  sheet('1501 Attakulangara', 412),
  sheet('1515 Kattakada', 289),
  sheet('1622 Thampanoor', 530),
  sheet('Section lookup', 24, 'hidden', ['Section', 'Subcategory']),
  sheet('Scratch', 3, 'very-hidden', ['', '']),
]

/** The overview with its own selection and mode, as the import wizard holds them. */
function Overview({ sheets = WORKBOOK, initial = sheets.map(() => false), refused = false }: { sheets?: ParsedSheet[]; initial?: boolean[]; refused?: boolean }) {
  const [selected, setSelected] = useState(initial)
  const [mode, setMode] = useState<GroupMode>('separate')
  const [mergeName, setMergeName] = useState('Store sales')
  return (
    <ImportOverview fileName="October store sales.xlsx" sheets={sheets} selected={selected} onSelect={setSelected}
      onContinue={() => {}} refused={refused} mode={mode} onMode={setMode} mergeName={mergeName} onMergeName={setMergeName} />
  )
}

const meta = {
  title: 'Admin/Import/ImportOverview',
  component: ImportOverview,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The first step of importing a spreadsheet: what is in the file, one line per sheet with its rows, columns and first headers. ' +
          'Nothing is selected when it opens; hidden sheets are listed in their own collapsed section. With two or more sheets ticked the ' +
          'person chooses one Table each or one merged Table. The import wizard holds the selection and mode; use it only there.',
      },
    },
  },
  args: {
    fileName: 'October store sales.xlsx', sheets: WORKBOOK, selected: WORKBOOK.map(() => false), onSelect: fn(), onContinue: fn(),
    refused: false, mode: 'separate', onMode: fn(), mergeName: 'Store sales', onMergeName: fn(),
  },
  render: () => <Overview />,
} satisfies Meta<typeof ImportOverview>
export default meta
type Story = StoryObj<typeof meta>

export const NothingSelected: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('iw-ov-section-hidden')).not.toHaveAttribute('open')
    await expect(canvas.getByTestId('iw-ov-count')).toHaveTextContent('0 of 5 sheets selected')
  },
}

export const ThreeSheetsMerged: Story = {
  name: 'Three sheets ticked, merged into one Table',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByTestId('iw-ov-all-visible'))
    await userEvent.click(canvas.getByTestId('iw-ov-mode-merge'))
    await expect(canvas.getByTestId('iw-ov-merge-name')).toHaveValue('Store sales')
    await expect(canvas.getByTestId('iw-ov-tally')).toHaveTextContent(/1 Table$/)
  },
}

export const OneSheet: Story = { name: 'A single-sheet file (a CSV)', render: () => <Overview sheets={[sheet('stores.csv', 128)]} initial={[true]} /> }

export const Refused: Story = { name: 'Continue refused (nothing picked)', render: () => <Overview refused /> }

export const ManySheets: Story = {
  name: 'Seventeen sheets, long names',
  render: () => <Overview sheets={Array.from({ length: 17 }, (_, i) => sheet(`Store ${1501 + i} sales register for October 2026 (all sections, including festive)`, 50 + i * 7))} />,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement).getByTestId('iw-overview')
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
  },
}

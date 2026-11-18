// The file drop area is a keyboard control: Tab reaches it, Enter and Space
// open the file chooser as a click does, and it is announced as a button.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { FileDropZone } from '../src/components/FileDropZone'

function setup() {
  const onFile = vi.fn()
  render(
    <>
      <button>before</button>
      <FileDropZone testId="zone" inputTestId="zone-input" label="Choose a file to import" onFile={onFile}>
        Drop here
      </FileDropZone>
    </>,
  )
  const input = screen.getByTestId('zone-input') as HTMLInputElement
  const click = vi.spyOn(input, 'click')
  return { onFile, click }
}

describe('FileDropZone', () => {
  test('Tab moves focus onto the drop area', async () => {
    setup()
    const user = userEvent.setup()
    await user.tab()
    await user.tab()
    expect(screen.getByTestId('zone')).toHaveFocus()
  })

  test('it is announced as a button named for what it does', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Choose a file to import' })).toBe(screen.getByTestId('zone'))
  })

  test('Enter opens the file chooser', async () => {
    const { click } = setup()
    const user = userEvent.setup()
    screen.getByTestId('zone').focus()
    await user.keyboard('{Enter}')
    expect(click).toHaveBeenCalledTimes(1)
  })

  test('Space opens the file chooser', async () => {
    const { click } = setup()
    const user = userEvent.setup()
    screen.getByTestId('zone').focus()
    await user.keyboard(' ')
    expect(click).toHaveBeenCalledTimes(1)
  })

  test('a click opens the file chooser', async () => {
    const { click } = setup()
    await userEvent.setup().click(screen.getByTestId('zone'))
    expect(click).toHaveBeenCalledTimes(1)
  })
})

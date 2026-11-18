import { useRef, useState, type ReactNode, type RefObject } from 'react'

/**
 * The box a file is dropped on, or clicked to choose one. It is a button for
 * the keyboard: Tab reaches it, Enter and Space open the file chooser as a
 * click does, and `label` names what it does for a screen reader. The page
 * keeps its own words as `children`; `dragClassName` and `className` carry
 * the page's own padding and drag tint.
 */
export function FileDropZone({
  testId,
  inputTestId,
  label,
  onFile,
  inputRef,
  className = '',
  dragClassName = 'border-action bg-action-tint text-action',
  children,
}: {
  testId: string
  inputTestId: string
  label: string
  onFile: (file: File) => void
  /** For a page that must reset the chosen file (so the same file can be chosen again). */
  inputRef?: RefObject<HTMLInputElement | null>
  className?: string
  dragClassName?: string
  children: ReactNode
}) {
  const own = useRef<HTMLInputElement>(null)
  const input = inputRef ?? own
  const [dragging, setDragging] = useState(false)
  return (
    <div
      data-testid={testId}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        // Only the box itself: a button inside it (remove the file) keeps its own keys.
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
        e.preventDefault()
        input.current?.click()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) onFile(file)
      }}
      className={`mb-4 cursor-pointer rounded-md border-2 border-dashed text-center text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${className} ${
        dragging ? dragClassName : 'border-border-control text-ink-muted hover:border-action'
      }`}
    >
      {children}
      <input
        ref={input}
        type="file"
        accept=".csv,.tsv,.xlsx,.xlsm,.xls"
        data-testid={inputTestId}
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
        }}
      />
    </div>
  )
}

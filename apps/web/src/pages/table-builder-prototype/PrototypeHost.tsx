// PROTOTYPE — THROWAWAY. Mounts on the real /admin/new-table route:
// ?variant=A|B|C picks a UX variant, no param = the real TableBuilder.
// Three variants of the New Table page, switchable via ?variant=, judged
// against the real Admin chrome. See #151 for the questions being answered.
import { useState } from 'react'
import { TableBuilder } from '../TableBuilder'
import { PrototypeSwitcher, currentVariant } from './PrototypeSwitcher'
import { VariantA } from './VariantA'
import { VariantB } from './VariantB'
import { VariantC } from './VariantC'

export function PrototypeHost() {
  const [variant, setVariant] = useState(currentVariant)
  return (
    <>
      {variant === 'A' && <VariantA />}
      {variant === 'B' && <VariantB />}
      {variant === 'C' && <VariantC />}
      {variant === 'current' && <TableBuilder />}
      <PrototypeSwitcher variant={variant} onChange={setVariant} />
    </>
  )
}

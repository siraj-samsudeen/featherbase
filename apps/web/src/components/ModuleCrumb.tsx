import { Link } from '@tanstack/react-router'
import { useModuleHomePage } from '../lib/home-pages'

/** #1340 (verifier round 4): the module crumb: the Table's module, opening its home page (else Admin's home). */
export function ModuleCrumb({ meta, className, testid }: { meta: { name: string; module?: string | null } | undefined; className?: string; testid?: string }) {
  const page = useModuleHomePage(meta)
  const words = meta?.module || 'Home'
  return page
    ? <Link to="/featherbase/admin/home/$name" params={{ name: page }} className={className} data-testid={testid}>{words}</Link>
    : <Link to="/featherbase/admin" className={className} data-testid={testid}>{words}</Link>
}

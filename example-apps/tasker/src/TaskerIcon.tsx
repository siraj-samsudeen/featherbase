import type { ReactNode } from 'react'

export type TaskerIconName = 'inbox' | 'work' | 'verify' | 'issues' | 'together' | 'stores' | 'projects' | 'personal' | 'views'

export function TaskerIcon({ name }: { name: TaskerIconName }) {
  const paths: Record<TaskerIconName, ReactNode> = {
    inbox: <><path d="M4 5.5h16v13H4z" /><path d="M4 14h4l2 2h4l2-2h4" /></>,
    work: <><circle cx="12" cy="8" r="3" /><path d="M5.5 20c.6-4 2.7-6 6.5-6s5.9 2 6.5 6" /></>,
    verify: <><circle cx="12" cy="12" r="8.5" /><path d="m8.2 12.3 2.6 2.6 5-5.4" /></>,
    issues: <><path d="M12 4 3.5 19h17z" /><path d="M12 10v4M12 16.8v.2" /></>,
    together: <><circle cx="9" cy="8" r="2.5" /><circle cx="16.5" cy="9" r="2" /><path d="M3.5 19c.5-3.5 2.3-5.2 5.5-5.2s5 1.7 5.5 5.2" /><path d="M14.5 14.4c3.3-.4 5.3 1.1 6 4.1" /></>,
    stores: <><path d="M4 9.5 5.5 4.5h13L20 9.5" /><path d="M4 9.5c0 1.5 1.2 2.5 2.7 2.5S9.3 11 9.3 9.5c0 1.5 1.2 2.5 2.7 2.5s2.7-1 2.7-2.5c0 1.5 1.1 2.5 2.6 2.5S20 11 20 9.5" /><path d="M5.5 12v7.5h13V12M10 19.5v-4.5h4v4.5" /></>,
    projects: <><path d="M3.5 7.5h6l2-2h9v13h-17z" /><path d="M3.5 9.5h17" /></>,
    personal: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 4V2.8M15 4V2.8M8.5 10h7M8.5 14h5" /></>,
    views: <><path d="M5 7h14M5 12h14M5 17h14" /><circle cx="8" cy="7" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="11" cy="17" r="1.5" /></>,
  }
  return <svg className="tasker-nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

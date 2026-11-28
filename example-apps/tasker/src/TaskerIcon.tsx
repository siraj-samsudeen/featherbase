import type { ReactNode } from 'react'

// #1385 (slice 4): the sidebar's icons are the platform's (its rows are declared); this one is the projects
// directory's own.
export type TaskerIconName = 'projects'

export function TaskerIcon({ name }: { name: TaskerIconName }) {
  const paths: Record<TaskerIconName, ReactNode> = {
    projects: <><path d="M3.5 7.5h6l2-2h9v13h-17z" /><path d="M3.5 9.5h17" /></>,
  }
  return <svg className="tasker-nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

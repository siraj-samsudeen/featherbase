import { useQuery } from '@tanstack/react-query'
import { api, listAll } from './api'

export interface Place { row_id: string; place_name: string; place_type: string }
export interface AssetType { row_id: string; type_name: string }
export interface Asset {
  row_id: string
  asset_name: string
  asset_type: string
  place: string
  area: string | null
  asset_status: string
  make: string | null
  model: string | null
  serial_no: string | null
  warranty_until: string | null
}
export interface Job {
  row_id: string
  updated_at: string
  asset: string
  problem: string
  details: string | null
  priority: string
  job_state: string
  assigned_to: string | null
  place: string | null
  reported_at: string | null
  fix_by: string | null
  fixed_at: string | null
  work_done: string | null
  repair_cost: string | null
  created_by: string
}
export interface Person { row_id: string; full_name: string }

const ASSET_FIELDS = ['row_id', 'asset_name', 'asset_type', 'place', 'area', 'asset_status', 'make', 'model', 'serial_no', 'warranty_until']
const JOB_FIELDS = ['row_id', 'updated_at', 'asset', 'problem', 'details', 'priority', 'job_state', 'assigned_to', 'place', 'reported_at', 'fix_by', 'fixed_at', 'work_done', 'repair_cost', 'created_by']

export const usePlaces = () => useQuery({ queryKey: ['assets', 'places'], queryFn: () => listAll<Place>('equipment.place', { fields: ['row_id', 'place_name', 'place_type'], order_by: 'place_name asc' }) })
export const useTypes = () => useQuery({ queryKey: ['assets', 'types'], queryFn: () => listAll<AssetType>('equipment.asset_type', { fields: ['row_id', 'type_name'], order_by: 'type_name asc' }) })
export const useAssets = () => useQuery({ queryKey: ['assets', 'assets'], queryFn: () => listAll<Asset>('equipment.asset', { fields: ASSET_FIELDS, order_by: 'asset_name asc' }) })
export const useJobs = () => useQuery({ queryKey: ['assets', 'jobs'], queryFn: () => listAll<Job>('equipment.job', { fields: JOB_FIELDS, order_by: 'created_at desc' }) })
export const usePeople = () => useQuery({ queryKey: ['assets', 'people'], queryFn: () => api.get<{ data: Person[] }>('/api/table_members/equipment.job').then(result => result.data) })

export function nameOf<T extends { row_id: string }>(rows: T[] | undefined, id: string | null | undefined, field: keyof T): string {
  if (!id) return ''
  const row = rows?.find(candidate => candidate.row_id === id)
  return row ? String(row[field]) : id
}

/** Technicians and managers move jobs on; the server checks this on every save. */
export function canWorkJobs(roles: string[]) {
  return roles.some(role => ['Assets Technician', 'Assets Manager', 'System Manager'].includes(role))
}

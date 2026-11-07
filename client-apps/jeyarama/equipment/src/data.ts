import { useQuery } from '@tanstack/react-query'
import { api, listAll } from './api'
import { siteOf } from './jobRules'

export interface Place { row_id: string; updated_at?: string; place_name: string; place_level: string; parent_place: string | null; site_kind: string | null; sap_plant: string | null; area_code?: string | null; area_custodian?: string | null; site_manager?: string | null }
export interface AssetType { row_id: string; updated_at?: string; type_name: string; asset_class?: string | null; sticker?: string | null; counting_note?: string | null; engineering_maintained?: boolean }
export interface AssetClass { row_id: string; updated_at: string; class_name: string; sap_class_code: string | null; code_confirmed: boolean }
export interface Entity { row_id: string; entity_name: string; short_name: string | null; entity_status: string }
export interface Asset {
  row_id: string
  asset_name: string
  asset_type: string
  place: string
  book_status: string
  condition: string
  custody_status: string
  owner_entity: string | null
  operator_entity: string | null
  cost_centre: string | null
  custodian: string | null
  location_custodian: boolean
  sap_company_code: string | null
  sap_asset_no: string | null
  sap_asset_sub: string | null
  sap_equipment_no: string | null
  legacy_id: string | null
  sap_refreshed_at: string | null
  make: string | null
  model: string | null
  serial_no: string | null
  warranty_until: string | null
  amc_vendor: string | null
  amc_until: string | null
  tag_no?: string | null
  tag_status?: string | null
  asset_class?: string | null
  control_category?: string | null
  ownership?: string | null
  owner_name?: string | null
  quantity?: number | null
  usage?: string | null
  book_value?: string | null
  counted_in?: string | null
  counted_at?: string | null
  tagged_by?: string | null
  recorded_by?: string | null
  updated_at?: string
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
  failure_started_at: string | null
  reported_at: string | null
  fix_by: string | null
  responded_at: string | null
  repair_started_at: string | null
  restored_at: string | null
  cause: string | null
  work_done: string | null
  spares: string | null
  outside_service: string | null
  repair_cost: string | null
  created_by: string
}
export interface Restoration { row_id: string; job: string; note: string | null; created_by: string; created_at: string }
export interface Person { row_id: string; full_name: string }

const ASSET_FIELDS = ['row_id', 'asset_name', 'asset_type', 'place', 'book_status', 'condition', 'custody_status', 'owner_entity', 'operator_entity',
  'cost_centre', 'custodian', 'location_custodian', 'sap_company_code', 'sap_asset_no', 'sap_asset_sub', 'sap_equipment_no', 'legacy_id', 'sap_refreshed_at',
  'make', 'model', 'serial_no', 'warranty_until', 'amc_vendor', 'amc_until', 'tag_no', 'tag_status', 'asset_class', 'control_category', 'ownership', 'owner_name',
  'quantity', 'usage', 'book_value', 'counted_in', 'counted_at', 'tagged_by', 'recorded_by', 'updated_at']
const JOB_FIELDS = ['row_id', 'updated_at', 'asset', 'problem', 'details', 'priority', 'job_state', 'assigned_to', 'place', 'failure_started_at', 'reported_at',
  'fix_by', 'responded_at', 'repair_started_at', 'restored_at', 'cause', 'work_done', 'spares', 'outside_service', 'repair_cost', 'created_by']

export const usePlaces = () => useQuery({ queryKey: ['assets', 'places'], queryFn: () => listAll<Place>('equipment.place', { fields: ['row_id', 'updated_at', 'place_name', 'place_level', 'parent_place', 'site_kind', 'sap_plant', 'area_code', 'area_custodian', 'site_manager'], order_by: 'place_name asc' }) })
export const useTypes = () => useQuery({ queryKey: ['assets', 'types'], queryFn: () => listAll<AssetType>('equipment.asset_type', { fields: ['row_id', 'updated_at', 'type_name', 'asset_class', 'sticker', 'counting_note', 'engineering_maintained'], order_by: 'type_name asc' }) })
export const useClasses = () => useQuery({ queryKey: ['assets', 'classes'], queryFn: () => listAll<AssetClass>('equipment.asset_class', { fields: ['row_id', 'updated_at', 'class_name', 'sap_class_code', 'code_confirmed'], order_by: 'class_name asc' }) })
export const useEntities = () => useQuery({ queryKey: ['assets', 'entities'], queryFn: () => listAll<Entity>('equipment.entity', { fields: ['row_id', 'entity_name', 'short_name', 'entity_status'], order_by: 'entity_name asc' }) })
export const useAssets = () => useQuery({ queryKey: ['assets', 'assets'], queryFn: () => listAll<Asset>('equipment.asset', { fields: ASSET_FIELDS, order_by: 'asset_name asc' }) })
export const useJobs = () => useQuery({ queryKey: ['assets', 'jobs'], queryFn: () => listAll<Job>('equipment.job', { fields: JOB_FIELDS, order_by: 'created_at desc' }) })
export const useRestorations = () => useQuery({ queryKey: ['assets', 'restorations'], queryFn: () => listAll<Restoration>('equipment.restoration', { fields: ['row_id', 'job', 'note', 'created_by', 'created_at'] }) })
export const usePeople = () => useQuery({ queryKey: ['assets', 'people'], queryFn: () => api.get<{ data: Person[] }>('/api/table_members/equipment.job').then(result => result.data) })

export function nameOf<T extends { row_id: string }>(rows: T[] | undefined, id: string | null | undefined, field: keyof T): string {
  if (!id) return ''
  const row = rows?.find(candidate => candidate.row_id === id)
  return row ? String(row[field]) : id
}

/** Sites only: the places people choose from in filters and on the label sheet. */
export function sitesOf(places: Place[] | undefined): Place[] {
  return (places ?? []).filter(place => place.place_level === 'Site')
}

/** Whether a place sits anywhere inside a site (or is the site). */
export function inSite(placeId: string | null | undefined, site: string, places: Place[] | undefined): boolean {
  return siteOf(placeId, places ?? []) === site
}

/** Technicians and managers move jobs on; the server checks this on every save. */
export function canWorkJobs(roles: string[]) {
  return roles.some(role => ['Assets Technician', 'Assets Manager', 'System Manager'].includes(role))
}

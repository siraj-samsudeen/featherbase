// Made-up org chart rows for the unit tests. Two stores: Lakeside (9901), with
// floors Ground and First, and Hillview (9902), with no floors. People are
// psn_101, psn_102 and so on. No real store, person or figure.
import type { OrgChart, Row } from './coverage.ts'

export const LAKESIDE = '9901'
export const HILLVIEW = '9902'

/** A job assignment row, current from 2026-07-01 unless the row says otherwise. */
export function job(person: string, job: string, place: Row = {}, store = LAKESIDE): Row {
  return { row_id: `ja-${person}-${job.replace(/ /g, '')}-${Object.values(place).join('-') || store}`,
    person, job, store, starts_on: '2026-07-01', ends_on: null, acting: false, reports_to: null, ...place }
}

export function chart(jobs: Row[] = []): OrgChart {
  return {
    floors: [
      { row_id: 'f-ground', store: LAKESIDE, floor_name: 'Ground' },
      { row_id: 'f-first', store: LAKESIDE, floor_name: 'First' },
    ],
    departments: [
      { row_id: 'd-ethnic', store: LAKESIDE, department_key: 'dm-P-107', name: 'Ladies Ethnic' },
      { row_id: 'd-bridal', store: LAKESIDE, department_key: 'dm-P-108', name: 'Bridal' },
      { row_id: 'd-kids', store: LAKESIDE, department_key: 'dm-P-109', name: null },
      { row_id: 'd-hill', store: HILLVIEW, department_key: 'dm-P-120', name: 'Hillview Apparel' },
    ],
    sections: [
      { row_id: 's-sarees', store: LAKESIDE, section_name: 'Sarees', floor: 'f-ground', department: 'd-ethnic', team_leaders_allowed: 1 },
      { row_id: 's-silk', store: LAKESIDE, section_name: 'Silk Sarees', floor: 'f-first', department: 'd-ethnic', team_leaders_allowed: 1 },
      { row_id: 's-lehenga', store: LAKESIDE, section_name: 'Lehenga', floor: 'f-first', department: 'd-bridal', team_leaders_allowed: 1 },
      { row_id: 's-kids', store: LAKESIDE, section_name: 'Kids Wear', floor: 'f-first', department: 'd-kids', team_leaders_allowed: 2 },
      { row_id: 's-tops', store: LAKESIDE, section_name: 'Women Tops', floor: 'f-ground', department: 'd-kids', team_leaders_allowed: 1 },
      { row_id: 's-hill-acc', store: HILLVIEW, section_name: 'Accessories', floor: null, department: 'd-hill', team_leaders_allowed: 1 },
    ],
    placements: [
      { row_id: 'p1', store: LAKESIDE, subcategory: '010101001', section: 's-sarees', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'p2', store: LAKESIDE, subcategory: '010101002', section: 's-silk', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'p3', store: LAKESIDE, subcategory: '010101003', section: 's-lehenga', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'p4', store: LAKESIDE, subcategory: '010202001', section: 's-kids', starts_on: '2026-01-01', ends_on: null },
      // Women Scarf: Women Tops until 15-Aug, then Sarees (a festive move).
      { row_id: 'p5', store: LAKESIDE, subcategory: '010303001', section: 's-tops', starts_on: '2026-01-01', ends_on: '2026-08-15' },
      { row_id: 'p6', store: LAKESIDE, subcategory: '010303001', section: 's-sarees', starts_on: '2026-08-15', ends_on: null },
      { row_id: 'p7', store: LAKESIDE, subcategory: '010303002', section: 's-tops', starts_on: '2026-01-01', ends_on: null },
      { row_id: 'p8', store: HILLVIEW, subcategory: '010404001', section: 's-hill-acc', starts_on: '2026-01-01', ends_on: null },
    ],
    jobs,
  }
}

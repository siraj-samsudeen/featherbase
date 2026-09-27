#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const START = '<!-- capability-catalog:start -->'
const END = '<!-- capability-catalog:end -->'
const STATUS = {
  available: '✓ Available',
  partial: '◐ Partial',
  planned: '◇ Planned',
  'not-started': '○ Not started',
  blocked: '! Blocked',
}
const DISPOSITION = {
  current: 'Current direction',
  deferred: 'Deferred',
  rejected: 'Rejected',
  superseded: 'Superseded',
}
const PROVING_STAGE = {
  planned: 'Planned',
  active: 'Active proof',
  proven: 'Proven',
  retired: 'Retired proof',
}
const KINDS = new Set(['capability', 'capability-group', 'design-option', 'proving-application'])
const LIST_FIELDS = new Set([
  'alternatives',
  'capabilities',
  'issues',
  'proving_applications',
  'related',
  'specifications',
])
const SCALAR_FIELDS = new Set([
  'disposition',
  'id',
  'kind',
  'order',
  'parent',
  'stage',
  'status',
  'summary',
  'title',
])

function scalar(value) {
  if (/^-?\d+$/.test(value)) return Number(value)
  if (value === 'true') return true
  if (value === 'false') return false
  return value.replace(/^(['"])(.*)\1$/, '$2')
}

export function parseCapabilityPage(content, filePath) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw new Error(`${filePath}: missing frontmatter`)

  const entry = { filePath, body: content.slice(match[0].length) }
  let activeList = null
  for (const [index, rawLine] of match[1].split(/\r?\n/).entries()) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue
    const item = rawLine.match(/^\s{2}-\s+(.+)$/)
    if (item) {
      if (!activeList) throw new Error(`${filePath}:${index + 2}: list item has no field`)
      entry[activeList].push(scalar(item[1].trim()))
      continue
    }
    const field = rawLine.match(/^([a-z_]+):(?:\s*(.*))?$/)
    if (!field) throw new Error(`${filePath}:${index + 2}: unsupported frontmatter syntax`)
    const [, key, value = ''] = field
    if (!LIST_FIELDS.has(key) && !SCALAR_FIELDS.has(key)) {
      throw new Error(`${filePath}:${index + 2}: unknown field ${key}`)
    }
    if (LIST_FIELDS.has(key)) {
      if (value) throw new Error(`${filePath}:${index + 2}: ${key} must be a list`)
      entry[key] = []
      activeList = key
    } else {
      if (!value) throw new Error(`${filePath}:${index + 2}: ${key} needs a value`)
      entry[key] = scalar(value.trim())
      activeList = null
    }
  }
  entry.frontmatter = match[0].trimEnd()
  return entry
}

function markdownFiles(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const target = path.join(directory, item.name)
    return item.isDirectory() ? markdownFiles(target) : item.name.endsWith('.md') ? [target] : []
  })
}

function readCatalog(root) {
  const directory = path.join(root, 'docs/capabilities')
  const entries = markdownFiles(directory).map(filePath => {
    const parsed = parseCapabilityPage(fs.readFileSync(filePath, 'utf8'), filePath)
    parsed.relativePath = path.relative(root, filePath).split(path.sep).join('/')
    return parsed
  })
  return entries.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.title.localeCompare(b.title))
}

function validate(entries, root) {
  const errors = []
  const byId = new Map()
  for (const entry of entries) {
    for (const field of ['id', 'kind', 'title', 'summary']) {
      if (!entry[field]) errors.push(`${entry.relativePath}: missing ${field}`)
    }
    if (entry.id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) {
      errors.push(`${entry.relativePath}: invalid id ${entry.id}`)
    }
    if (byId.has(entry.id)) errors.push(`${entry.relativePath}: duplicate id ${entry.id}`)
    else byId.set(entry.id, entry)
    if (entry.kind && !KINDS.has(entry.kind)) errors.push(`${entry.relativePath}: unknown kind ${entry.kind}`)
    if (entry.kind === 'design-option') {
      if (!DISPOSITION[entry.disposition]) errors.push(`${entry.relativePath}: invalid or missing disposition`)
      if (entry.status) errors.push(`${entry.relativePath}: design options use disposition, not status`)
    } else if (entry.kind === 'proving-application') {
      if (!PROVING_STAGE[entry.stage]) errors.push(`${entry.relativePath}: invalid or missing stage`)
      if (entry.status || entry.disposition) {
        errors.push(`${entry.relativePath}: proving applications use stage, not status or disposition`)
      }
    } else if (!STATUS[entry.status]) {
      errors.push(`${entry.relativePath}: invalid or missing status`)
    }
    if (['capability', 'design-option'].includes(entry.kind) && !entry.parent) {
      errors.push(`${entry.relativePath}: missing parent`)
    }
  }

  for (const entry of entries) {
    if (entry.parent && !byId.has(entry.parent)) errors.push(`${entry.relativePath}: unknown parent ${entry.parent}`)
    for (const related of entry.related ?? []) {
      if (!byId.has(related)) errors.push(`${entry.relativePath}: unknown related capability ${related}`)
      if (related === entry.id) errors.push(`${entry.relativePath}: capability cannot relate to itself`)
    }
    for (const alternative of entry.alternatives ?? []) {
      const target = byId.get(alternative)
      if (!target) errors.push(`${entry.relativePath}: unknown design option ${alternative}`)
      else if (target.kind !== 'design-option') errors.push(`${entry.relativePath}: ${alternative} is not a design option`)
    }
    for (const specification of entry.specifications ?? []) {
      const specPath = path.join(root, 'openspec/specs', specification, 'spec.md')
      if (!fs.existsSync(specPath)) errors.push(`${entry.relativePath}: missing specification ${specification}`)
    }
    for (const issue of entry.issues ?? []) {
      if (!Number.isInteger(issue) || issue <= 0) errors.push(`${entry.relativePath}: invalid issue ${issue}`)
    }
    for (const capability of entry.capabilities ?? []) {
      const target = byId.get(capability)
      if (!target) errors.push(`${entry.relativePath}: unknown capability ${capability}`)
      else if (target.kind !== 'capability') errors.push(`${entry.relativePath}: ${capability} is not a leaf capability`)
    }
    for (const provingApplication of entry.proving_applications ?? []) {
      const target = byId.get(provingApplication)
      if (!target) errors.push(`${entry.relativePath}: unknown proving application ${provingApplication}`)
      else if (target.kind !== 'proving-application') {
        errors.push(`${entry.relativePath}: ${provingApplication} is not a proving application`)
      } else if (!(target.capabilities ?? []).includes(entry.id)) {
        errors.push(`${target.relativePath}: must list ${entry.id} to match ${entry.relativePath}`)
      }
    }
    if (entry.kind === 'proving-application') {
      for (const capability of entry.capabilities ?? []) {
        const target = byId.get(capability)
        if (target?.kind === 'capability' && !(target.proving_applications ?? []).includes(entry.id)) {
          errors.push(`${target.relativePath}: must list ${entry.id} to match ${entry.relativePath}`)
        }
      }
    }
  }

  for (const group of entries.filter(entry => entry.kind === 'capability-group')) {
    const children = entries.filter(entry => entry.parent === group.id && entry.kind === 'capability')
    if (children.length === 0) errors.push(`${group.relativePath}: capability group has no children`)
    const expected = deriveGroupStatus(children)
    if (children.length && group.status !== expected) {
      errors.push(`${group.relativePath}: status ${group.status} does not match child-derived status ${expected}`)
    }
  }

  if (errors.length) throw new Error(errors.sort().join('\n'))
  return { entries, byId }
}

function deriveGroupStatus(children) {
  if (children.some(child => child.status === 'blocked')) return 'blocked'
  if (children.every(child => child.status === 'available')) return 'available'
  if (children.some(child => ['available', 'partial'].includes(child.status))) return 'partial'
  if (children.some(child => child.status === 'planned')) return 'planned'
  return 'not-started'
}

function link(fromFile, toFile, label) {
  let relative = path.relative(path.dirname(fromFile), toFile).split(path.sep).join('/')
  if (!relative.startsWith('.')) relative = `./${relative}`
  return `[${label}](${relative})`
}

function entryLink(fromFile, entry, label = entry.title) {
  return link(fromFile, entry.filePath, label)
}

function specLink(fromFile, root, specification) {
  return link(fromFile, path.join(root, 'openspec/specs', specification, 'spec.md'), specification)
}

function issueLinks(issues = []) {
  return issues.length
    ? issues.map(issue => `[#${issue}](https://github.com/siraj-samsudeen/featherbase/issues/${issue})`).join(', ')
    : '—'
}

function specificationLinks(fromFile, root, specifications = []) {
  return specifications.length
    ? specifications.map(specification => specLink(fromFile, root, specification)).join(', ')
    : 'Not yet written'
}

function renderConnections(entry, catalog, root) {
  const { entries, byId } = catalog
  const children = entries.filter(item => item.parent === entry.id && item.kind === 'capability')
  const alternatives = (entry.alternatives ?? []).map(id => byId.get(id))
  const lines = [START]

  if (children.length) {
    lines.push('', '## Sub-capabilities', '', '| Capability | Status | Description | Specifications | Tickets |', '| --- | --- | --- | --- | --- |')
    for (const child of children) {
      lines.push(`| ${entryLink(entry.filePath, child)} | ${STATUS[child.status]} | ${child.summary} | ${specificationLinks(entry.filePath, root, child.specifications)} | ${issueLinks(child.issues)} |`)
    }
  } else if (entry.kind === 'capability') {
    lines.push('', '## Sub-capabilities', '', 'No reusable sub-capabilities have been separated yet.')
  }

  if (entry.kind === 'proving-application') {
    lines.push('', '## Capabilities proved', '', '| Capability | Status | Description | Specifications | Tickets |', '| --- | --- | --- | --- | --- |')
    for (const capability of (entry.capabilities ?? []).map(id => byId.get(id))) {
      lines.push(`| ${entryLink(entry.filePath, capability)} | ${STATUS[capability.status]} | ${capability.summary} | ${specificationLinks(entry.filePath, root, capability.specifications)} | ${issueLinks(capability.issues)} |`)
    }
  }

  lines.push('', '## Connections')
  if (entry.parent) lines.push('', `**Parent:** ${entryLink(entry.filePath, byId.get(entry.parent))}`)
  lines.push('', `**Related capabilities:** ${(entry.related ?? []).length ? entry.related.map(id => entryLink(entry.filePath, byId.get(id))).join(', ') : 'None recorded.'}`)
  lines.push('', `**Specifications:** ${specificationLinks(entry.filePath, root, entry.specifications)}`)
  lines.push('', `**Tickets:** ${issueLinks(entry.issues)}`)
  if (entry.kind !== 'proving-application') {
    lines.push('', `**Proving applications:** ${(entry.proving_applications ?? []).length ? entry.proving_applications.map(id => entryLink(entry.filePath, byId.get(id))).join(', ') : 'None recorded.'}`)
  }

  if (alternatives.length) {
    lines.push('', '## Design options', '')
    for (const option of alternatives) {
      lines.push(`- ${entryLink(entry.filePath, option)} — **${DISPOSITION[option.disposition]}.** ${option.summary}`)
    }
  }

  lines.push('', END)
  return lines.join('\n')
}

function replaceGeneratedBlock(entry, generated) {
  const expression = new RegExp(`${START}[\\s\\S]*?${END}`)
  const body = expression.test(entry.body)
    ? entry.body.replace(expression, generated)
    : `${entry.body.trimEnd()}\n\n${generated}\n`
  return `${entry.frontmatter}\n\n${body.trimStart()}`
}

function renderIndex(catalog, root) {
  const { entries } = catalog
  const output = [
    '<!-- Generated by `pnpm generate:capabilities`; edit `docs/capabilities/**/*.md`, not this file. -->',
    '',
    '# Featherbase capability catalog',
    '',
    'Featherbase is an agent-first application framework. This catalog links every current capability to its detailed page, accepted specifications, delivery tickets, related capabilities, proving applications and considered alternatives.',
    '',
    'Status is judged against the **portable application contract**. Similar behavior in the generic Admin is Partial until an installed application can reuse it without rebuilding the behavior.',
    '',
    '## Status key',
    '',
    ...Object.values(STATUS).map(status => `- **${status}**`),
    '',
    '[Request or prioritize a capability](https://github.com/siraj-samsudeen/featherbase/issues/new?title=Capability%20request%3A%20&body=Capability%3A%0A%0AApplication%20or%20workflow%3A%0A%0AWhy%20the%20current%20capabilities%20are%20not%20enough%3A)',
  ]
  const indexPath = path.join(root, 'docs/APPLICATION_MODEL.md')
  for (const group of entries.filter(entry => entry.kind === 'capability-group')) {
    output.push('', `## ${entryLink(indexPath, group)}`, '', `${STATUS[group.status]} — ${group.summary}`, '', '| Capability | Status | Description | Specifications | Tickets |', '| --- | --- | --- | --- | --- |')
    for (const child of entries.filter(entry => entry.parent === group.id && entry.kind === 'capability')) {
      output.push(`| ${entryLink(indexPath, child)} | ${STATUS[child.status]} | ${child.summary} | ${specificationLinks(indexPath, root, child.specifications)} | ${issueLinks(child.issues)} |`)
    }
  }

  const provingApplications = entries.filter(entry => entry.kind === 'proving-application')
  output.push('', '## Proving applications', '', 'Proving applications exercise capabilities together in real application lifecycles. They are evidence and design drivers, not framework capabilities.', '', '| Application | Stage | Purpose | Capabilities |', '| --- | --- | --- | --- |')
  for (const application of provingApplications) {
    const capabilities = (application.capabilities ?? []).map(id => entryLink(indexPath, catalog.byId.get(id))).join(', ')
    output.push(`| ${entryLink(indexPath, application)} | ${PROVING_STAGE[application.stage]} | ${application.summary} | ${capabilities} |`)
  }

  const options = entries.filter(entry => entry.kind === 'design-option')
  output.push('', '## Design options', '', 'Design options preserve alternatives and trade-offs without presenting them as promised product features.', '', '| Option | Disposition | Related capability | Reason |', '| --- | --- | --- | --- |')
  for (const option of options) {
    const parent = catalog.byId.get(option.parent)
    output.push(`| ${entryLink(indexPath, option)} | ${DISPOSITION[option.disposition]} | ${entryLink(indexPath, parent)} | ${option.summary} |`)
  }
  output.push('', '## Catalog maintenance', '', '- Edit structured frontmatter and explanation on the detailed capability pages.', '- Run `pnpm generate:capabilities` to rebuild this index and every generated connection block.', '- Run `pnpm check:capabilities` to detect invalid links, relationships, statuses or generated-document drift.', '- Accepted specifications remain the behavior authority; GitHub issues remain the work and discussion record.', '')
  return output.join('\n')
}

function generatedState(root) {
  const entries = readCatalog(root)
  const catalog = validate(entries, root)
  const files = new Map([[path.join(root, 'docs/APPLICATION_MODEL.md'), renderIndex(catalog, root)]])
  for (const entry of entries) files.set(entry.filePath, replaceGeneratedBlock(entry, renderConnections(entry, catalog, root)))
  return files
}

export function writeCatalog(root = process.cwd()) {
  for (const [filePath, content] of generatedState(root)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`)
  }
}

export function checkCatalog(root = process.cwd()) {
  const drift = []
  for (const [filePath, expected] of generatedState(root)) {
    const actual = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
    const normalized = expected.endsWith('\n') ? expected : `${expected}\n`
    if (actual !== normalized) drift.push(path.relative(root, filePath))
  }
  if (drift.length) {
    throw new Error(`Capability catalog is stale; run \`pnpm generate:capabilities\`:\n${drift.join('\n')}`)
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--write')) {
      writeCatalog()
      console.log('Capability catalog generated')
    } else {
      checkCatalog()
      console.log('Capability catalog OK')
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

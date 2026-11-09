// #1105 (mcp-table-lifecycle D3): the CSV an agent sends over /mcp is parsed
// on the server, RFC 4180 style, into the rows the import wizard would read.
import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/csv'

describe('parseCsv', () => {
  it('splits rows and cells', () => {
    expect(parseCsv('name,city\nAcme,Chennai\nBala,Madurai')).toEqual([['name', 'city'], ['Acme', 'Chennai'], ['Bala', 'Madurai']])
  })

  it('reads CRLF line ends and ignores the final line end', () => {
    expect(parseCsv('name,city\r\nAcme,Chennai\r\n')).toEqual([['name', 'city'], ['Acme', 'Chennai']])
  })

  it('drops a leading byte-order mark', () => {
    expect(parseCsv('﻿name\nAcme')).toEqual([['name'], ['Acme']])
  })

  it('keeps commas, doubled quotes and line breaks inside a quoted cell', () => {
    expect(parseCsv('name,note\n"Acme, Ltd","said ""hi""\ntwice"')).toEqual([['name', 'note'], ['Acme, Ltd', 'said "hi"\ntwice']])
  })

  it('keeps empty cells, a trailing one included', () => {
    expect(parseCsv('a,b,c\n1,,\n')).toEqual([['a', 'b', 'c'], ['1', '', '']])
  })

  it('splits on the delimiter it is given', () => {
    expect(parseCsv('a\tb\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a;b\n1;2', ';')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('refuses a quoted cell that is never closed, naming its row', () => {
    expect(() => parseCsv('name\nAcme\n"Bala')).toThrow(/row 3.*never closed/)
  })
})

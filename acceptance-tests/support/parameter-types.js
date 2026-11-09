'use strict';

// {columns}: a written list of column names, "Section, MCH and Floor", or one
// name such as "Updated By". A column name is one or more capitalised words.
// {ordinal}: "first" to "tenth".

const { defineParameterType } = require('@cucumber/cucumber');

const NAME = '[A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)*';

defineParameterType({
  name: 'columns',
  regexp: new RegExp(`${NAME}(?:, ${NAME})*(?: and ${NAME})?`),
  transformer: (text) => text.split(/, | and /),
});

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

defineParameterType({
  name: 'ordinal',
  regexp: new RegExp(ORDINALS.join('|')),
  transformer: (word) => ORDINALS.indexOf(word) + 1,
});

const COUNTS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

defineParameterType({
  name: 'count',
  regexp: new RegExp(COUNTS.join('|')),
  transformer: (word) => COUNTS.indexOf(word) + 1,
});

// {day}: a calendar day as people write it, "4 November 2026", given to steps
// as 'YYYY-MM-DD'.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

defineParameterType({
  name: 'day',
  regexp: new RegExp(`\\d{1,2} (?:${MONTHS.join('|')}) \\d{4}`),
  transformer: (text) => {
    const [day, month, year] = text.split(' ');
    return `${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
  },
});

// {member}: a Tasker member a scenario names by first name.
defineParameterType({
  name: 'member',
  regexp: /Meena|Ravi|Suresh|Kumar/,
});

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

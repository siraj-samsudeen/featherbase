'use strict';

// Public HTTP flow: no form behavior is under test in server-only #739.
const { randomUUID } = require('node:crypto');

class MetadataOverrides {
  constructor(api) {
    this.api = api;
    this.table = `Override Catalogue ${randomUUID().slice(0, 8)}`;
    this.id = `${this.table}-adjustment`;
  }

  async prepare() {
    await this.api.createTable({
      name: this.table,
      columns: [{ column_name: 'category', column_type: 'Data', label: 'Category' }],
    });
  }

  async save(values) {
    const response = await this.api.call('POST', '/api/table/Metadata%20Override', {
      row_id: this.id, table_name: this.table, ...values,
    });
    this.result = { status: response.status(), body: await response.json() };
    return this.result;
  }

  async meta() {
    const response = await this.api.call('GET', `/api/table/${encodeURIComponent(this.table)}:meta`, undefined, [200], 'read effective metadata');
    return response.json();
  }

  async columnLabelAsName() {
    this.missing = 'Category';
    await this.save({ column_name: this.missing, property: 'in_list_view', value: 'true' });
  }

  async wholeTableLabel() {
    await this.save({ column_name: '', property: 'label', value: 'Customer catalogue' });
  }

  async otherCatalogue() {
    await this.api.createTable({ name: `${this.table} Suppliers`, columns: [{ column_name: 'supplier', column_type: 'Data' }] });
  }

  async foreignColumn() {
    this.missing = 'supplier';
    await this.save({ column_name: this.missing, property: 'label', value: 'Supplier' });
  }

  async addPriority() {
    await this.api.saveRow('Custom Field', {
      row_id: `${this.table}-priority`, dt: this.table, column_name: 'priority', column_type: 'Data', label: 'Priority',
    });
  }

  async priorityLabel() {
    await this.save({ column_name: 'priority', property: 'label', value: 'Urgency' });
  }

  async savedCategory() {
    await this.save({ column_name: 'category', property: 'label', value: 'Product group' });
    this.beforeRow = await this.api.row('Metadata Override', this.id);
    this.beforeMeta = await this.meta();
  }

  async edit(values) {
    const response = await this.api.call('PATCH', `/api/table/Metadata%20Override/${encodeURIComponent(this.id)}`, {
      updated_at: this.beforeRow.updated_at, ...values,
    });
    this.result = { status: response.status(), body: await response.json() };
  }

  async invalidTargetEdit() {
    this.missing = 'absent_category';
    await this.edit({ column_name: this.missing });
  }

  async invalidBoolean(value) {
    await this.save({ column_name: 'category', property: 'hidden', value });
  }

  setting(name) {
    return { hidden: 'hidden', required: 'reqd', 'read-only': 'read_only', 'list visibility': 'in_list_view' }[name];
  }

  async booleanSetting(name, value) {
    const property = this.setting(name);
    // Start at the opposite value so a no-op edit cannot satisfy either side.
    await this.save({ column_name: 'category', property, value: ['false', '0'].includes(value) ? 'true' : 'false' });
    this.beforeRow = await this.savedRow();
    await this.edit({ value });
  }

  async savedHiddenCategory() {
    await this.save({ column_name: 'category', property: 'hidden', value: 'true' });
    this.beforeRow = await this.savedRow();
    this.beforeMeta = await this.meta();
  }

  async unknownProperty(target) {
    await this.save({ column_name: target === 'column' ? 'category' : null, property: 'not_a_property', value: 'true' });
  }

  async uniqueness(value) {
    await this.save({ column_name: 'category', property: 'unique', value });
  }

  permittedNames() {
    return this.result.body.error.message.split('Permitted properties: ')[1]?.split(', ');
  }

  savedRow() { return this.api.row('Metadata Override', this.id); }
}

module.exports = { MetadataOverrides };

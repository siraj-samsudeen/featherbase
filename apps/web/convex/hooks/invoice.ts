import type { Invoice } from "../doctypes.gen";

// Lifecycle hooks for the "invoice" DocType — generated once, edit
// freely. `validate` throws to reject a save; `beforeSave` returns the data
// to store. Both run on create and update, after declarative validation.

export function validate(data: Invoice): void {
  if (data.amount <= 0) {
    throw new Error("amount must be positive");
  }
}

export function beforeSave(data: Invoice): Invoice {
  return { ...data, customer: data.customer.trim() };
}

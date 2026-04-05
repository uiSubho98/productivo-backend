import Invoice from '../models/Invoice.js';

/**
 * Generate a sequential invoice number.
 * Format: INV-YYYY-NNNN (sequential per year)
 */
export const generateInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  // Find the highest invoice number for this year
  const last = await Invoice.findOne(
    { invoiceNumber: { $regex: `^${prefix}` } },
    { invoiceNumber: 1 },
    { sort: { invoiceNumber: -1 } }
  );
  let seq = 1;
  if (last) {
    const parts = last.invoiceNumber.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
};

/**
 * Format a number as currency.
 * @param {number} amount
 * @param {string} currency - currency code (default: INR)
 * @param {string} locale - locale string (default: en-IN)
 */
export const formatCurrency = (amount, currency = 'INR', locale = 'en-IN') => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
};

/**
 * Format a date to a readable string.
 * @param {Date|string} date
 * @param {string} locale
 */
export const formatDate = (date, locale = 'en-IN') => {
  const d = new Date(date);
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

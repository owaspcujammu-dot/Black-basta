/**
 * Minimal CSV writer for admin exports.
 *
 * Player-controlled text (names, teams, submitted flags) is defused against
 * spreadsheet formula injection: a cell starting with = + - @ tab or CR is
 * prefixed with an apostrophe so Excel / Sheets show it as text instead of
 * evaluating it. Numbers are written as-is.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV with a UTF-8 byte-order mark, so Excel reads non-English names correctly. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

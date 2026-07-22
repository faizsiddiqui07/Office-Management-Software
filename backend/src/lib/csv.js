/** Builds a CSV string from a header array + array of row arrays. */
export function toCsv(header, rows) {
  const esc = (v) => {
    let s = String(v ?? '');
    // These exports are opened in Excel and Sheets, which read a leading =, +, - or @
    // as a formula. Every one of these columns is free text somebody typed into the
    // app, so prefix a quote to keep it text. Excel shows the value, not the quote.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
}

// Neutralise spreadsheet formula injection. A cell whose text begins with
// = + - @ (or a leading tab/CR that Excel trims first) is run as a formula by
// Excel / LibreOffice — e.g. =HYPERLINK / =WEBSERVICE can exfiltrate data or
// chain a command. Faculty control name and designation, so every text cell of
// every export goes through this: it prefixes such a value with a single quote,
// which forces the cell to be read as text.
export function csvSafe<T>(v: T): T | string {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return `'${v}`;
  return v;
}

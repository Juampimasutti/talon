import type { ParsedSheet } from "./parse";

export async function readWorkbook(data: Buffer): Promise<ParsedSheet[]> {
  const XLSX = await import("xlsx");
  const book = XLSX.read(data, { type: "buffer", cellDates: false, raw: false });
  return book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    const table = matrix.map((row) => row.map((cell) => String(cell ?? "").trim()));
    if (table.length === 0) return { name, columns: [], rows: [] };
    const width = Math.max(...table.map((row) => row.length));
    const columns = table[0].map((cell, index) => cell || `Columna ${index + 1}`);
    while (columns.length < width) columns.push(`Columna ${columns.length + 1}`);
    const rows = table.slice(1).map((row) => {
      const copy = [...row];
      while (copy.length < columns.length) copy.push("");
      return copy.slice(0, columns.length);
    });
    return { name, columns, rows };
  }).filter((sheet) => sheet.columns.length > 0);
}

export async function writeWorkbook(sheets: ParsedSheet[]): Promise<Buffer> {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const matrix = [sheet.columns, ...sheet.rows];
    const worksheet = XLSX.utils.aoa_to_sheet(matrix);
    XLSX.utils.book_append_sheet(book, worksheet, sheet.name.slice(0, 31) || "Datos");
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

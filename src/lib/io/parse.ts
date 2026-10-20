export type ParsedSheet = {
  name: string;
  columns: string[];
  rows: string[][];
};

const DELIMITERS = [";", ",", "\t", "|"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

export function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

export function detectDelimiter(text: string): Delimiter {
  const sample = stripBom(text).split(/\r?\n/).slice(0, 8).join("\n");
  let best: Delimiter = ";";
  let bestScore = -1;
  for (const delimiter of DELIMITERS) {
    const lines = sample.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length === 0) continue;
    const counts = lines.map((line) => splitDelimitedLine(line, delimiter).length);
    const same = counts.every((count) => count === counts[0]);
    const score = (same ? 10 : 0) + counts[0];
    if (counts[0] > 1 && score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

export function parseDelimited(text: string, delimiter?: string): ParsedSheet {
  const clean = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const chosen = delimiter && delimiter !== "auto" ? delimiter : detectDelimiter(clean);
  const lines = clean.split("\n").filter((line, index, all) => line.trim() || index < all.length - 1);
  const table = lines.filter((line) => line.trim()).map((line) => splitDelimitedLine(line, chosen));
  if (table.length === 0) return { name: "datos", columns: [], rows: [] };
  const width = Math.max(...table.map((row) => row.length));
  const header = table[0].map((cell, index) => cell.trim() || `Columna ${index + 1}`);
  while (header.length < width) header.push(`Columna ${header.length + 1}`);
  const rows = table.slice(1).map((row) => {
    const copy = row.map((cell) => cell.trim());
    while (copy.length < header.length) copy.push("");
    return copy.slice(0, header.length);
  });
  return { name: "datos", columns: header, rows };
}

export function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

export function parseFixedWidth(text: string, widths: number[], hasHeader: boolean): ParsedSheet {
  const lines = stripBom(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim());
  const split = (line: string) => {
    const cells: string[] = [];
    let cursor = 0;
    for (const width of widths) {
      cells.push(line.slice(cursor, cursor + width).trim());
      cursor += width;
    }
    return cells;
  };
  if (!hasHeader) {
    return {
      name: "datos",
      columns: widths.map((_, index) => `Columna ${index + 1}`),
      rows: lines.map(split),
    };
  }
  const header = split(lines[0]).map((cell, index) => cell || `Columna ${index + 1}`);
  return { name: "datos", columns: header, rows: lines.slice(1).map(split) };
}

export function toDelimited(columns: string[], rows: string[][], delimiter: string): string {
  const lines = [columns, ...rows].map((row) => row.map((cell) => escapeCell(cell, delimiter)).join(delimiter));
  return `\uFEFF${lines.join("\r\n")}`;
}

function escapeCell(value: string, delimiter: string): string {
  if (value.includes('"') || value.includes(delimiter) || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function parseWidths(value: string): number[] {
  return value
    .split(/[^\d]+/)
    .map((part) => Number(part))
    .filter((width) => Number.isFinite(width) && width > 0);
}

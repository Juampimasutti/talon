import type { ParsedSheet } from "./parse";

type Field = { name: string; length: number };

/** Lee una tabla DBF de dBase / Visual FoxPro (campos C, N, D, L y F). */
export function parseDbf(buffer: Buffer, filename = "tabla"): ParsedSheet {
  const name = filename.replace(/\.dbf$/i, "");
  if (buffer.length < 32) return { name, columns: [], rows: [] };
  const recordCount = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields: Field[] = [];
  let offset = 32;
  while (offset + 32 <= headerLength && buffer[offset] !== 0x0d) {
    const fieldName = buffer.subarray(offset, offset + 11).toString("latin1").split("\0")[0]?.trim() ?? "";
    fields.push({ name: fieldName, length: buffer[offset + 16] || 0 });
    offset += 32;
  }
  const columns = fields.map((field) => field.name);
  const rows: string[][] = [];
  let cursor = headerLength;
  for (let index = 0; index < recordCount && cursor + recordLength <= buffer.length; index += 1) {
    const deleted = buffer[cursor] === 0x2a;
    let position = cursor + 1;
    const row = fields.map((field) => {
      const value = buffer.subarray(position, position + field.length).toString("latin1").replace(/\0/g, "").trim();
      position += field.length;
      return value;
    });
    if (!deleted) rows.push(row);
    cursor += recordLength;
  }
  return { name, columns, rows };
}

export function foxEntity(filename: string): string | null {
  const stem = filename.replace(/\.[^.]+$/, "").toUpperCase();
  const table: Record<string, string> = {
    CLIENTES: "clientes",
    PROVEEDO: "proveedores",
    PROVEEDOR: "proveedores",
    PROVEEDORES: "proveedores",
    ARTICULO: "articulos",
    ARTICULOS: "articulos",
    LISTAPRE: "listas",
    CUENTAS: "plan",
    SALDOS: "saldos",
  };
  return table[stem] ?? null;
}

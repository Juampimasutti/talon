import { describe, expect, it } from "vitest";
import { foxEntity, parseDbf } from "./dbf";

function sample(): Buffer {
  const header = Buffer.alloc(32 + 32 + 1);
  header[0] = 0x03;
  header.writeUInt32LE(1, 4);
  header.writeUInt16LE(32 + 32 + 1, 8);
  header.writeUInt16LE(1 + 10, 10);
  header.write("NOMBRE", 32, "ascii");
  header[32 + 11] = "C".charCodeAt(0);
  header[32 + 16] = 10;
  header[32 + 32] = 0x0d;
  const record = Buffer.alloc(11);
  record[0] = 0x20;
  record.write("ACME", 1, "ascii");
  return Buffer.concat([header, record]);
}

describe("dbf", () => {
  it("lee un registro y reconoce las tablas de Fox", () => {
    const sheet = parseDbf(sample(), "CLIENTES.dbf");
    expect(sheet.columns).toEqual(["NOMBRE"]);
    expect(sheet.rows[0]?.[0]).toBe("ACME");
    expect(foxEntity("PROVEEDO.DBF")).toBe("proveedores");
    expect(foxEntity("LISTAPRE.dbf")).toBe("listas");
  });
});

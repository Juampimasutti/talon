import { describe, expect, it } from "vitest";
import { buildCuit, cuitCheckDigit, formatCuit, isValidCuit } from "./cuit";

describe("CUIT", () => {
  it("valida el dígito verificador de un CUIT conocido", () => {
    expect(isValidCuit("20-12345678-6")).toBe(true);
    expect(isValidCuit("20123456786")).toBe(true);
    expect(isValidCuit("30-71234567-1")).toBe(true);
  });

  it("rechaza un dígito verificador tocado y longitudes raras", () => {
    expect(isValidCuit("20-12345678-7")).toBe(false);
    expect(isValidCuit("2012345678")).toBe(false);
    expect(isValidCuit("")).toBe(false);
    expect(isValidCuit("20-12345678-65")).toBe(false);
  });

  it("formatea y arma un CUIT con el dígito correcto", () => {
    expect(formatCuit("20123456786")).toBe("20-12345678-6");
    expect(buildCuit("27", "30111222")).toHaveLength(11);
    expect(isValidCuit(buildCuit("27", "30111222"))).toBe(true);
  });

  it("cuando el resto da 1, el dígito es 9", () => {
    let sample = "";
    for (let n = 0; n < 200_000 && !sample; n += 1) {
      const base = `30${String(n).padStart(8, "0")}`;
      const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
      const sum = base.split("").reduce((acc, char, index) => acc + Number(char) * weights[index], 0);
      if (11 - (sum % 11) === 10) sample = base;
    }
    expect(sample).not.toBe("");
    expect(cuitCheckDigit(sample)).toBe(9);
    expect(isValidCuit(`${sample}9`)).toBe(true);
    expect(isValidCuit(`${sample}0`)).toBe(false);
  });
});

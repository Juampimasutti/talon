import { z } from "zod";
import "./zod-es";
import { isValidCuit } from "./fiscal/cuit";
import { HttpError } from "./http";

export const partySchema = z.object({
  name: z.string().trim().min(1, "Falta el nombre").max(160),
  fantasyName: z.string().trim().max(160).optional().default(""),
  docType: z.enum(["CUIT", "DNI", "OTRO"]).default("CUIT"),
  cuit: z.string().trim().max(20).optional().default(""),
  taxCondition: z.enum(["ri", "monotributo", "cf", "exento"]),
  iibb: z.string().trim().max(40).optional().default(""),
  iibbPerceptionBps: z.number().int().min(0).max(5000).nullable().optional(),
  address: z.string().trim().max(160).optional().default(""),
  city: z.string().trim().max(80).optional().default(""),
  province: z.string().trim().max(80).optional().default(""),
  postalCode: z.string().trim().max(12).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.string().trim().max(120).optional().default(""),
  contact: z.string().trim().max(80).optional().default(""),
  priceListId: z.string().uuid().nullable().optional(),
  discountBps: z.number().int().min(0).max(10000).optional().default(0),
  creditLimitCents: z.number().int().min(0).max(50_000_000_000).optional().default(0),
  paymentTermsDays: z.number().int().min(0).max(365).optional().default(0),
  zone: z.string().trim().max(60).optional().default(""),
  notes: z.string().trim().max(500).optional().default(""),
  active: z.boolean().optional().default(true),
  customFields: z.array(z.object({ fieldId: z.string().uuid(), value: z.string().max(500) })).optional().default([]),
});

export const productSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  barcode: z.string().trim().max(40).optional().default(""),
  name: z.string().trim().min(1).max(180),
  categoryId: z.string().uuid().nullable().optional(),
  unit: z.string().trim().min(1).max(12).optional().default("u"),
  ivaRateBps: z.number().int().min(0).max(2700),
  taxTreatment: z.enum(["gravado", "exento", "no_gravado"]).optional().default("gravado"),
  tracksStock: z.boolean().optional().default(true),
  costCents: z.number().int().min(0).max(50_000_000_000),
  minStock: z.number().min(0).max(1_000_000).optional().default(0),
  supplierId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(500).optional().default(""),
  active: z.boolean().optional().default(true),
  prices: z.array(z.object({ priceListId: z.string().uuid(), priceCents: z.number().int().min(0) })).optional().default([]),
  customFields: z.array(z.object({ fieldId: z.string().uuid(), value: z.string().max(500) })).optional().default([]),
});

export const documentSchema = z.object({
  kind: z.enum(["venta", "compra", "pedido", "remito"]),
  documentTypeId: z.string().uuid(),
  pointOfSale: z.number().int().min(1).max(99999).optional(),
  partyId: z.string().uuid(),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha tiene que ser AAAA-MM-DD"),
  paymentMethod: z.enum(["contado", "cuenta_corriente"]).optional(),
  priceListId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  cashAccountId: z.string().uuid().nullable().optional(),
  letter: z.enum(["A", "B", "C"]).optional(),
  notes: z.string().max(1000).optional(),
  otherTaxesCents: z.number().int().min(0).max(1_000_000_000).optional(),
  acknowledgeCredit: z.boolean().optional(),
  allowNegativeStock: z.boolean().optional(),
  perceptions: z
    .array(z.object({ name: z.string().trim().min(1).max(80), rateBps: z.number().int().min(0).max(5000) }))
    .max(6)
    .optional(),
  supplierPos: z.number().int().min(1).max(99999).nullable().optional(),
  supplierNumber: z.number().int().min(1).max(99_999_999).nullable().optional(),
  sourceDocumentId: z.string().uuid().nullable().optional(),
  cae: z.string().trim().max(20).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid().nullable().optional(),
        description: z.string().max(200).optional(),
        quantity: z.number().positive().max(1_000_000),
        unitPriceCents: z.number().int().min(0).max(1_000_000_000).optional(),
        discountBps: z.number().int().min(0).max(10000).optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const companySchema = z.object({
  name: z.string().trim().min(1).max(120),
  legalName: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.string().trim().max(120).optional().default(""),
  address: z.string().trim().max(160).optional().default(""),
  city: z.string().trim().max(80).optional().default(""),
  province: z.string().trim().max(80).optional().default(""),
  pointOfSale: z.number().int().min(1).max(99999),
  blockNegativeStock: z.boolean(),
  allowNegativeCash: z.boolean().optional().default(false),
  enabledModules: z.array(z.string()).max(32),
});

export async function readBody<T>(req: Request, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "El cuerpo del pedido no es JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).slice(0, 3).join(" ");
    throw new HttpError(400, detail || "Revisá los datos del formulario");
  }
  return parsed.data;
}

export function normalizeTaxId(docType: string | undefined, cuit: string | undefined): string | null {
  const kind = docType || "CUIT";
  const value = (cuit ?? "").trim();
  if (!value) return null;
  if (kind === "CUIT") {
    if (!isValidCuit(value)) {
      throw new HttpError(400, "El CUIT no cierra. Revisá el dígito verificador.");
    }
    const digits = value.replace(/\D/g, "");
    return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
  }
  return value;
}

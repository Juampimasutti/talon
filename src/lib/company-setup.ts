import { z } from "zod";
import { isValidCuit } from "./fiscal/cuit";

export const SECTORS = {
  comercio: {
    label: "Comercio general",
    modules: [
      "clientes",
      "proveedores",
      "articulos",
      "ventas",
      "compras",
      "pedidos",
      "remitos",
      "stock",
      "caja",
      "cuentas_corrientes",
      "comprobantes",
      "auditoria",
      "informes",
    ],
  },
  estacion: {
    label: "Estación de servicio",
    modules: [
      "clientes",
      "proveedores",
      "articulos",
      "ventas",
      "compras",
      "stock",
      "caja",
      "cuentas_corrientes",
      "comprobantes",
      "auditoria",
      "informes",
      "estacion",
      "reparto",
    ],
  },
  inmobiliaria: {
    label: "Inmobiliaria",
    modules: [
      "inmobiliaria",
      "clientes",
      "proveedores",
      "ventas",
      "caja",
      "cuentas_corrientes",
      "comprobantes",
      "auditoria",
      "informes",
    ],
  },
  constructora: {
    label: "Constructora",
    modules: ["constructora",
      "clientes",
      "proveedores",
      "articulos",
      "ventas",
      "compras",
      "pedidos",
      "remitos",
      "stock",
      "caja",
      "cuentas_corrientes",
      "comprobantes",
      "auditoria",
      "informes",
    ],
  },
} as const;

export const createCompanySchema = z.object({
  name: z.string().trim().min(1, "Falta el nombre comercial").max(120),
  legalName: z.string().trim().min(1, "Falta la razón social").max(160),
  cuit: z
    .string()
    .refine(isValidCuit, "El CUIT no cierra. Revisá el dígito verificador."),
  taxCondition: z.enum(["ri", "monotributo", "exento"]),
  iibb: z.string().trim().max(40).default(""),
  address: z.string().trim().min(1, "Falta el domicilio").max(160),
  city: z.string().trim().max(80).default(""),
  province: z.string().trim().max(80).default(""),
  activityStartedOn: z
    .string()
    .refine(
      (value) =>
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value,
      "Fecha de inicio inválida",
    ),
  businessSector: z.enum([
    "comercio",
    "estacion",
    "inmobiliaria",
    "constructora",
  ]),
  pointsOfSale: z
    .array(z.number().int().min(1).max(99999))
    .min(1)
    .max(30)
    .refine(
      (points) => new Set(points).size === points.length,
      "Hay puntos de venta repetidos",
    ),
  enabledModules: z.array(z.string()).max(32),
  basicLedger: z.boolean().default(false),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

// Misma configuración funcional que el seed comercial, sin datos ficticios.
export const BASE_DOCUMENT_TYPES = [
  [
    "FAC",
    "Factura A/B/C",
    "venta",
    1,
    true,
    -1,
    true,
    "debit",
    true,
    "in",
    true,
    { A: 1, B: 6, C: 11 },
  ],
  [
    "NCR",
    "Nota de crédito",
    "venta",
    -1,
    true,
    1,
    true,
    "credit",
    true,
    "out",
    true,
    { A: 3, B: 8, C: 13 },
  ],
  [
    "ND",
    "Nota de débito",
    "venta",
    1,
    false,
    0,
    true,
    "debit",
    false,
    null,
    true,
    { A: 2, B: 7, C: 12 },
  ],
  ["PED", "Pedido", "pedido", 1, false, 0, false, null, false, null, false, {}],
  ["REM", "Remito", "remito", 1, true, -1, false, null, false, null, false, {}],
  [
    "REC",
    "Recibo",
    "venta",
    -1,
    false,
    0,
    true,
    "credit",
    true,
    "in",
    false,
    {},
  ],
  [
    "FCP",
    "Factura de compra",
    "compra",
    1,
    true,
    1,
    true,
    "credit",
    true,
    "out",
    true,
    { A: 1, B: 6, C: 11 },
  ],
  [
    "NCC",
    "Nota de crédito de compra",
    "compra",
    -1,
    true,
    -1,
    true,
    "debit",
    true,
    "in",
    true,
    { A: 3, B: 8, C: 13 },
  ],
] as const;

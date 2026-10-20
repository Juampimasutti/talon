export const ENTITIES = [
  { key: "clientes", module: "clientes", label: "Clientes" },
  { key: "proveedores", module: "proveedores", label: "Proveedores" },
  { key: "articulos", module: "articulos", label: "Artículos" },
  { key: "listas", module: "articulos", label: "Listas de precios" },
  { key: "stock", module: "stock", label: "Stock inicial" },
  { key: "ventas", module: "ventas", label: "Comprobantes de venta" },
  { key: "compras", module: "compras", label: "Comprobantes de compra" },
  { key: "plan", module: "contabilidad", label: "Plan de cuentas" },
] as const;

export type EntityKey = (typeof ENTITIES)[number]["key"];

export function entityModule(entity: EntityKey): string {
  return ENTITIES.find((item) => item.key === entity)?.module ?? entity;
}

export type FieldDef = { key: string; label: string; aliases: string[] };

const partyFields: FieldDef[] = [
  { key: "codigo", label: "Código", aliases: ["codigo", "cod", "nro", "numero"] },
  { key: "nombre", label: "Nombre", aliases: ["nombre", "razon social", "razon_social", "razonsocial", "denominacion", "denominacion comprador", "denominacion vendedor", "cliente", "proveedor"] },
  { key: "fantasia", label: "Fantasía", aliases: ["fantasia", "nombre fantasia", "nombre de fantasia"] },
  { key: "tipo_documento", label: "Tipo documento", aliases: ["tipo documento", "tipo doc", "tipodoc", "tipo doc comprador", "tipo doc vendedor"] },
  { key: "cuit", label: "CUIT", aliases: ["cuit", "nro doc", "nro documento", "nro doc comprador", "nro doc vendedor", "numero documento", "documento"] },
  { key: "condicion_iva", label: "Condición IVA", aliases: ["condicion iva", "condicion frente al iva", "posicion", "posicion iva", "iva", "categoria impositiva"] },
  { key: "ingresos_brutos", label: "Ingresos brutos", aliases: ["ingresos brutos", "iibb", "ing bruto"] },
  { key: "percepcion_iibb", label: "Percepción IIBB %", aliases: ["percepcion iibb", "percepcion", "alicuota iibb"] },
  { key: "domicilio", label: "Domicilio", aliases: ["domicilio", "direccion", "calle"] },
  { key: "localidad", label: "Localidad", aliases: ["localidad", "ciudad"] },
  { key: "provincia", label: "Provincia", aliases: ["provincia"] },
  { key: "codigo_postal", label: "Código postal", aliases: ["codigo postal", "cp", "cpa"] },
  { key: "telefono", label: "Teléfono", aliases: ["telefono", "tel", "celular"] },
  { key: "email", label: "Email", aliases: ["email", "mail", "correo"] },
  { key: "contacto", label: "Contacto", aliases: ["contacto"] },
  { key: "lista_precios", label: "Lista de precios", aliases: ["lista", "lista de precios", "listapre"] },
  { key: "descuento", label: "Descuento %", aliases: ["descuento", "dto", "bonificacion"] },
  { key: "limite_credito", label: "Límite de crédito", aliases: ["limite", "limite de credito", "credito"] },
  { key: "plazo_pago", label: "Plazo de pago", aliases: ["plazo", "plazo de pago", "dias"] },
  { key: "zona", label: "Zona", aliases: ["zona"] },
  { key: "notas", label: "Notas", aliases: ["notas", "observaciones"] },
  { key: "activo", label: "Activo", aliases: ["activo", "estado"] },
];

export const FIELDS: Record<EntityKey, FieldDef[]> = {
  clientes: partyFields,
  proveedores: partyFields.filter((field) => !["lista_precios", "descuento", "limite_credito", "contacto", "zona", "percepcion_iibb"].includes(field.key)),
  articulos: [
    { key: "sku", label: "SKU", aliases: ["sku", "codigo", "cod", "codart", "articulo"] },
    { key: "nombre", label: "Nombre", aliases: ["nombre", "descripcion", "descrip", "detalle"] },
    { key: "codigo_barras", label: "Código de barras", aliases: ["codigo de barras", "barras", "ean", "barcode"] },
    { key: "rubro", label: "Rubro", aliases: ["rubro", "categoria", "familia"] },
    { key: "unidad", label: "Unidad", aliases: ["unidad", "um"] },
    { key: "iva", label: "IVA %", aliases: ["iva", "alicuota", "tasa iva"] },
    { key: "tratamiento", label: "Tratamiento", aliases: ["tratamiento", "gravado", "tipo iva"] },
    { key: "mueve_stock", label: "Mueve stock", aliases: ["mueve stock", "stock", "controla stock"] },
    { key: "costo", label: "Costo", aliases: ["costo", "precio costo"] },
    { key: "stock_minimo", label: "Stock mínimo", aliases: ["stock minimo", "minimo", "punto de pedido"] },
    { key: "proveedor", label: "Proveedor", aliases: ["proveedor"] },
    { key: "lista_precios", label: "Lista de precios", aliases: ["lista", "lista de precios"] },
    { key: "precio", label: "Precio", aliases: ["precio", "precio venta", "precio unitario"] },
    { key: "notas", label: "Notas", aliases: ["notas"] },
    { key: "activo", label: "Activo", aliases: ["activo"] },
  ],
  listas: [
    { key: "lista_precios", label: "Lista de precios", aliases: ["lista", "lista de precios", "nombre"] },
    { key: "sku", label: "SKU", aliases: ["sku", "codigo", "articulo"] },
    { key: "precio", label: "Precio", aliases: ["precio", "importe"] },
  ],
  stock: [
    { key: "sku", label: "SKU", aliases: ["sku", "codigo", "articulo"] },
    { key: "deposito", label: "Depósito", aliases: ["deposito", "almacen", "sucursal"] },
    { key: "cantidad", label: "Cantidad", aliases: ["cantidad", "stock", "existencia", "saldo"] },
  ],
  ventas: documentFields("cliente"),
  compras: documentFields("proveedor"),
  plan: [
    { key: "codigo", label: "Código", aliases: ["codigo", "cuenta", "codcta"] },
    { key: "nombre", label: "Nombre", aliases: ["nombre", "descripcion"] },
    { key: "padre", label: "Cuenta padre", aliases: ["padre", "suma en", "depende de"] },
    { key: "imputable", label: "Imputable", aliases: ["imputable"] },
    { key: "tipo", label: "Tipo", aliases: ["tipo", "rubro", "naturaleza"] },
  ],
};

function documentFields(party: string): FieldDef[] {
  return [
    { key: "fecha", label: "Fecha", aliases: ["fecha", "fecha de emision", "fecha emision"] },
    { key: "tipo", label: "Código", aliases: ["tipo", "codigo", "comprobante", "tipo de comprobante"] },
    { key: "tipo_afip", label: "Código AFIP", aliases: ["tipo de comprobante", "codigo afip", "cod comprobante"] },
    { key: "letra", label: "Letra", aliases: ["letra"] },
    { key: "punto_venta", label: "Punto de venta", aliases: ["punto de venta", "pv", "pto vta"] },
    { key: "numero", label: "Número", aliases: ["numero", "numero de comprobante", "numero desde", "nro"] },
    { key: "cuit", label: "CUIT", aliases: ["cuit", "nro doc comprador", "nro doc vendedor", "documento"] },
    { key: "nombre", label: "Nombre", aliases: ["nombre", `denominacion ${party}`, "denominacion comprador", "denominacion vendedor", "razon social", party] },
    { key: "condicion_iva", label: "Condición IVA", aliases: ["condicion iva", "posicion"] },
    { key: "neto", label: "Neto gravado", aliases: ["neto", "neto gravado", "importe neto gravado", "importe neto gravado total", "imp neto gravado"] },
    { key: "iva", label: "IVA", aliases: ["iva", "total iva", "imp iva", "importe iva"] },
    { key: "exento", label: "Exento", aliases: ["exento", "exentas", "importe op exentas", "op exentas"] },
    { key: "no_gravado", label: "No gravado", aliases: ["no gravado", "importe neto no gravado", "neto no gravado"] },
    { key: "percepciones", label: "Percepciones", aliases: ["percepciones", "percepcion"] },
    { key: "otros", label: "Otros tributos", aliases: ["otros tributos", "otros", "tributos"] },
    { key: "total", label: "Total", aliases: ["total", "importe total", "imp total"] },
    { key: "cae", label: "CAE", aliases: ["cae", "cod autorizacion", "codigo de autorizacion"] },
    { key: "pago", label: "Condición de pago", aliases: ["pago", "condicion de pago", "forma de pago"] },
    { key: "sku", label: "SKU", aliases: ["sku", "codigo articulo"] },
    { key: "cantidad", label: "Cantidad", aliases: ["cantidad"] },
    { key: "precio", label: "Precio", aliases: ["precio", "precio unitario"] },
    { key: "notas", label: "Notas", aliases: ["notas", "observaciones"] },
  ];
}

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[%$.]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function autoMap(columns: string[], entity: EntityKey, extraLabels: { key: string; label: string }[] = []): Record<string, string> {
  const fields = [...FIELDS[entity], ...extraLabels.map((field) => ({ ...field, aliases: [normalizeHeader(field.label), field.key] }))];
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const column of columns) {
    const normal = normalizeHeader(column);
    const match = fields.find((field) => !used.has(field.key) && (normalizeHeader(field.label) === normal || field.aliases.some((alias) => normalizeHeader(alias) === normal)));
    if (match) {
      mapping[column] = match.key;
      used.add(match.key);
    } else {
      mapping[column] = "";
    }
  }
  return mapping;
}

export function detectProfile(columns: string[]): "arca_emitidos" | "arca_recibidos" | null {
  const names = columns.map(normalizeHeader);
  const has = (fragment: string) => names.some((name) => name.includes(fragment));
  if (has("punto de venta") && has("tipo de comprobante") && has("denominacion comprador")) return "arca_emitidos";
  if (has("punto de venta") && has("tipo de comprobante") && has("denominacion vendedor")) return "arca_recibidos";
  return null;
}

export function exampleRows(entity: EntityKey): string[][] {
  if (entity === "clientes") {
    return [["C0001", "Kiosco del Parque", "20-12345678-6", "Responsable inscripto", "Paraná", "Mostrador"]];
  }
  if (entity === "proveedores") {
    return [["P0001", "Ferretera del Litoral SA", "30-71234567-1", "Responsable inscripto", "Santa Fe"]];
  }
  if (entity === "articulos") {
    return [["YER-001", "Yerba mate 1 kg", "Almacén", "21", "1800", "2790"]];
  }
  if (entity === "listas") return [["Mostrador", "YER-001", "2790"]];
  if (entity === "stock") return [["YER-001", "Depósito central", "40"]];
  if (entity === "ventas" || entity === "compras") {
    return [["2026-10-01", "FAC", "A", "4", "120", "20-12345678-6", "Kiosco del Parque", "10000", "2100", "0", "0", "0", "0", "12100"]];
  }
  return [["1.1.01", "Caja", "1", "si", "activo"]];
}

export function exampleColumns(entity: EntityKey): string[] {
  if (entity === "clientes") return ["Código", "Nombre", "CUIT", "Condición IVA", "Localidad", "Lista de precios"];
  if (entity === "proveedores") return ["Código", "Nombre", "CUIT", "Condición IVA", "Localidad"];
  if (entity === "articulos") return ["Código", "Nombre", "Rubro", "IVA %", "Costo", "Precio"];
  if (entity === "listas") return ["Lista de precios", "SKU", "Precio"];
  if (entity === "stock") return ["SKU", "Depósito", "Cantidad"];
  if (entity === "ventas" || entity === "compras") {
    return ["Fecha", "Código", "Letra", "Punto de venta", "Número", "CUIT", "Nombre", "Neto gravado", "IVA", "Exento", "No gravado", "Percepciones", "Otros tributos", "Total"];
  }
  return ["Código", "Nombre", "Cuenta padre", "Imputable", "Tipo"];
}

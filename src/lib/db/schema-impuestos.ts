import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const impCondicionesIva = pgTable("imp_condiciones_iva", {
  codigo: integer("codigo").primaryKey(),
  descripcion: text("descripcion").notNull(),
  talonTaxCondition: text("talon_tax_condition"),
  vigenteDesde: date("vigente_desde", { mode: "string" }).notNull(),
  vigenteHasta: date("vigente_hasta", { mode: "string" }),
});

export const impTiposComprobante = pgTable("imp_tipos_comprobante", {
  codigo: integer("codigo").primaryKey(),
  descripcion: text("descripcion").notNull(),
  letra: text("letra"),
  clase: text("clase").notNull(),
  signo: integer("signo").notNull(),
  discriminaIva: boolean("discrimina_iva").notNull(),
  usaVentas: boolean("usa_ventas").notNull(),
  usaCompras: boolean("usa_compras").notNull(),
  vigenteDesde: date("vigente_desde", { mode: "string" }).notNull(),
  vigenteHasta: date("vigente_hasta", { mode: "string" }),
});

export const impAlicuotas = pgTable("imp_alicuotas", {
  codigo: integer("codigo").primaryKey(),
  bps: integer("bps").notNull().unique(),
  descripcion: text("descripcion").notNull(),
});

export const impCodigosOperacion = pgTable("imp_codigos_operacion", {
  codigo: text("codigo").primaryKey(),
  descripcion: text("descripcion").notNull(),
  vigenteDesde: date("vigente_desde", { mode: "string" }).notNull(),
  vigenteHasta: date("vigente_hasta", { mode: "string" }),
});

export const impMonedas = pgTable("imp_monedas", {
  codigo: text("codigo").primaryKey(),
  descripcion: text("descripcion").notNull(),
  vigenteDesde: date("vigente_desde", { mode: "string" }).notNull(),
  vigenteHasta: date("vigente_hasta", { mode: "string" }),
});

export const impTiposDocumento = pgTable("imp_tipos_documento", {
  codigo: integer("codigo").primaryKey(),
  descripcion: text("descripcion").notNull(),
  vigenteDesde: date("vigente_desde", { mode: "string" }).notNull(),
  vigenteHasta: date("vigente_hasta", { mode: "string" }),
});

export const impMatrizLetras = pgTable("imp_matriz_letras", {
  id: uuid("id").primaryKey().defaultRandom(),
  condEmisor: integer("cond_emisor").notNull(),
  condReceptor: integer("cond_receptor").notNull(),
  letrasPermitidas: text("letras_permitidas").array().notNull(),
  norma: text("norma").notNull(),
  vigenteDesde: date("vigente_desde", { mode: "string" }).notNull(),
  vigenteHasta: date("vigente_hasta", { mode: "string" }),
});

export const impEmpresas = pgTable("imp_empresas", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  nombre: text("nombre").notNull(),
  razonSocial: text("razon_social").notNull(),
  cuit: text("cuit").notNull(),
  condicionIva: text("condicion_iva").notNull(),
  rubro: text("rubro"),
  activa: boolean("activa").notNull().default(true),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("imp_empresas_company_cuit").on(table.companyId, table.cuit),
  unique("imp_empresas_id_company").on(table.id, table.companyId),
]);

export const impConfig = pgTable("imp_config", {
  companyId: uuid("company_id").notNull(),
  empresaClienteId: uuid("empresa_cliente_id").notNull(),
  toleranciaCents: bigint("tolerancia_cents", { mode: "number" }).notNull().default(5),
  crearEnTalonDefault: boolean("crear_en_talon_default").notNull().default(false),
  prorrateaDefault: boolean("prorratea_default").notNull().default(false),
  modoProrrateoDefault: text("modo_prorrateo_default").notNull().default("global"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.companyId, table.empresaClienteId] })]);

export const impPuntosVenta = pgTable("imp_puntos_venta", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  empresaClienteId: uuid("empresa_cliente_id").notNull(),
  numero: integer("numero").notNull(),
  sistema: text("sistema").notNull(),
  activo: boolean("activo").notNull().default(true),
}, (table) => [unique("imp_puntos_venta_empresa_numero").on(table.companyId, table.empresaClienteId, table.numero)]);

export const impActividades = pgTable("imp_actividades", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  empresaClienteId: uuid("empresa_cliente_id").notNull(),
  codigo: text("codigo").notNull(),
  descripcion: text("descripcion").notNull(),
  principal: boolean("principal").notNull().default(false),
}, (table) => [unique("imp_actividades_empresa_codigo").on(table.companyId, table.empresaClienteId, table.codigo)]);

export const impContrapartes = pgTable("imp_contrapartes", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  empresaClienteId: uuid("empresa_cliente_id").notNull(),
  docTipo: integer("doc_tipo").notNull(),
  docNro: text("doc_nro").notNull(),
  denominacion: text("denominacion").notNull(),
  condicionIva: integer("condicion_iva"),
  condicionARevisar: boolean("condicion_a_revisar").notNull().default(false),
  customerId: uuid("customer_id"),
  supplierId: uuid("supplier_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("imp_contrapartes_empresa_documento").on(table.companyId, table.empresaClienteId, table.docTipo, table.docNro)]);

export const impMapeoTributos = pgTable("imp_mapeo_tributos", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  empresaClienteId: uuid("empresa_cliente_id").notNull(),
  nombreTalon: text("nombre_talon").notNull(),
  destino: text("destino").notNull(),
}, (table) => [unique("imp_mapeo_tributos_empresa_nombre").on(table.companyId, table.empresaClienteId, table.nombreTalon)]);

export const impPeriodos = pgTable("imp_periodos", {
  companyId: uuid("company_id").notNull(),
  empresaClienteId: uuid("empresa_cliente_id").notNull(),
  periodo: text("periodo").notNull(),
  estado: text("estado").notNull().default("abierto"),
  prorratea: boolean("prorratea").notNull().default(false),
  modoProrrateo: text("modo_prorrateo").notNull().default("global"),
  coeficienteBps: integer("coeficiente_bps"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.companyId, table.empresaClienteId, table.periodo] })]);

export const impImportJobs = pgTable("imp_import_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  empresaClienteId: uuid("empresa_cliente_id").notNull(),
  tipo: text("tipo").notNull(),
  archivoNombre: text("archivo_nombre").notNull(),
  archivoHash: text("archivo_hash").notNull(),
  estado: text("estado").notNull().default("previsualizado"),
  resumen: jsonb("resumen").$type<Record<string, unknown>>().notNull().default({}),
  error: text("error"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
});

export const impComprobantes = pgTable("imp_comprobantes", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  empresaClienteId: uuid("empresa_cliente_id").notNull(),
  libro: text("libro").notNull(),
  origen: text("origen").notNull(),
  sourceDocumentId: uuid("source_document_id"),
  importRowId: uuid("import_row_id"),
  fechaCbte: date("fecha_cbte", { mode: "string" }).notNull(),
  periodo: text("periodo").notNull(),
  tipoCbte: integer("tipo_cbte").notNull(),
  puntoVenta: integer("punto_venta").notNull(),
  numeroDesde: bigint("numero_desde", { mode: "number" }).notNull(),
  numeroHasta: bigint("numero_hasta", { mode: "number" }).notNull(),
  cae: text("cae"),
  docNroEmisor: text("doc_nro_emisor").notNull(),
  docTipo: integer("doc_tipo").notNull(),
  docNro: text("doc_nro").notNull(),
  denominacion: text("denominacion").notNull(),
  condicionIva: integer("condicion_iva"),
  contraparteId: uuid("contraparte_id"),
  moneda: text("moneda").notNull(),
  despacho: text("despacho"),
  tipoCambio: numeric("tipo_cambio", { precision: 18, scale: 6, mode: "number" }).notNull().default(1),
  netoNoGravadoCents: bigint("neto_no_gravado_cents", { mode: "number" }).notNull().default(0),
  exentoCents: bigint("exento_cents", { mode: "number" }).notNull().default(0),
  percepIvaCents: bigint("percep_iva_cents", { mode: "number" }).notNull().default(0),
  percepOtrosNacCents: bigint("percep_otros_nac_cents", { mode: "number" }).notNull().default(0),
  percepIibbCents: bigint("percep_iibb_cents", { mode: "number" }).notNull().default(0),
  percepMunicipalesCents: bigint("percep_municipales_cents", { mode: "number" }).notNull().default(0),
  impuestosInternosCents: bigint("impuestos_internos_cents", { mode: "number" }).notNull().default(0),
  otrosTributosCents: bigint("otros_tributos_cents", { mode: "number" }).notNull().default(0),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  tipoOperacion: text("tipo_operacion").notNull().default("otros"),
  creditoFiscalComputableCents: bigint("credito_fiscal_computable_cents", { mode: "number" }).notNull().default(0),
  prorratea: boolean("prorratea").notNull().default(false),
  estado: text("estado").notNull().default("vigente"),
  requiereRevision: boolean("requiere_revision").notNull().default(false),
  avisos: jsonb("avisos").$type<string[]>().notNull().default([]),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("imp_comprobantes_empresa_identity").on(table.companyId, table.empresaClienteId, table.libro, table.docNroEmisor, table.tipoCbte, table.puntoVenta, table.numeroDesde)]);

export const impComprobanteAlicuotas = pgTable("imp_comprobante_alicuotas", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  empresaClienteId: uuid("empresa_cliente_id").notNull(),
  comprobanteId: uuid("comprobante_id").notNull(),
  alicuotaCodigo: integer("alicuota_codigo").notNull(),
  netoCents: bigint("neto_cents", { mode: "number" }).notNull(),
  ivaCents: bigint("iva_cents", { mode: "number" }).notNull(),
}, (table) => [unique("imp_comprobante_alicuotas_rate").on(table.comprobanteId, table.alicuotaCodigo)]);

export const impImportRows = pgTable("imp_import_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  empresaClienteId: uuid("empresa_cliente_id").notNull(),
  jobId: uuid("job_id").notNull(),
  fila: integer("fila").notNull(),
  raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
  estado: text("estado").notNull(),
  motivo: text("motivo"),
  comprobanteId: uuid("comprobante_id"),
}, (table) => [unique("imp_import_rows_job_fila").on(table.jobId, table.fila)]);

export const impLiquidaciones = pgTable("imp_liquidaciones", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  empresaClienteId: uuid("empresa_cliente_id").notNull(),
  periodo: text("periodo").notNull(),
  estado: text("estado").notNull().default("borrador"),
  totales: jsonb("totales").$type<Record<string, number>>().notNull().default({}),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
  confirmadaPor: uuid("confirmada_por"),
  confirmadaAt: timestamp("confirmada_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("imp_liquidaciones_empresa_periodo").on(table.companyId, table.empresaClienteId, table.periodo)]);

export const impLiquidacionItems = pgTable("imp_liquidacion_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  empresaClienteId: uuid("empresa_cliente_id").notNull(),
  liquidacionId: uuid("liquidacion_id").notNull(),
  rubro: text("rubro").notNull(),
  concepto: text("concepto").notNull(),
  importeCents: bigint("importe_cents", { mode: "number" }).notNull(),
  origen: text("origen").notNull(),
  posicion: integer("posicion").notNull().default(0),
});

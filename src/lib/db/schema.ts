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

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  businessSector: text("business_sector").notNull().default("comercio"),
  tipo: text("tipo").notNull().default("negocio"),
  activityStartedOn: date("activity_started_on", { mode: "string" }),
  cuit: text("cuit").notNull(),
  taxCondition: text("tax_condition").notNull(),
  iibb: text("iibb"),
  address: text("address"),
  city: text("city"),
  province: text("province"),
  postalCode: text("postal_code"),
  phone: text("phone"),
  email: text("email"),
  pointOfSale: integer("point_of_sale").notNull().default(1),
  enabledModules: text("enabled_modules").array().notNull(),
  blockNegativeStock: boolean("block_negative_stock").notNull().default(true),
  allowNegativeCash: boolean("allow_negative_cash").notNull().default(false),
  sandboxOf: uuid("sandbox_of"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isSystem: boolean("is_system").notNull().default(true),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull(),
    permission: text("permission").notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permission] })],
);

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  companyId: uuid("company_id").notNull(),
  roleId: uuid("role_id").notNull(),
  active: boolean("active").notNull().default(true),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
});

export const priceLists = pgTable("price_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
});

export const warehouses = pgTable("warehouses", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
});

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  fantasyName: text("fantasy_name"),
  docType: text("doc_type").notNull().default("CUIT"),
  cuit: text("cuit"),
  taxCondition: text("tax_condition").notNull(),
  address: text("address"),
  city: text("city"),
  province: text("province"),
  phone: text("phone"),
  email: text("email"),
  paymentTermsDays: integer("payment_terms_days").notNull().default(0),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  fantasyName: text("fantasy_name"),
  docType: text("doc_type").notNull().default("CUIT"),
  cuit: text("cuit"),
  taxCondition: text("tax_condition").notNull(),
  iibb: text("iibb"),
  iibbPerceptionBps: integer("iibb_perception_bps"),
  address: text("address"),
  city: text("city"),
  province: text("province"),
  postalCode: text("postal_code"),
  phone: text("phone"),
  email: text("email"),
  contact: text("contact"),
  priceListId: uuid("price_list_id"),
  discountBps: integer("discount_bps").notNull().default(0),
  creditLimitCents: bigint("credit_limit_cents", { mode: "number" }).notNull().default(0),
  paymentTermsDays: integer("payment_terms_days").notNull().default(0),
  zone: text("zone"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  sku: text("sku").notNull(),
  barcode: text("barcode"),
  name: text("name").notNull(),
  categoryId: uuid("category_id"),
  unit: text("unit").notNull().default("u"),
  ivaRateBps: integer("iva_rate_bps").notNull().default(2100),
  taxTreatment: text("tax_treatment").notNull().default("gravado"),
  tracksStock: boolean("tracks_stock").notNull().default(true),
  costCents: bigint("cost_cents", { mode: "number" }).notNull().default(0),
  minStock: numeric("min_stock", { precision: 14, scale: 3, mode: "number" }).notNull().default(0),
  supplierId: uuid("supplier_id"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productPrices = pgTable(
  "product_prices",
  {
    productId: uuid("product_id").notNull(),
    priceListId: uuid("price_list_id").notNull(),
    companyId: uuid("company_id").notNull(),
    priceCents: bigint("price_cents", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.productId, table.priceListId] })],
);

export const stockLevels = pgTable(
  "stock_levels",
  {
    productId: uuid("product_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    companyId: uuid("company_id").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 3, mode: "number" }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.productId, table.warehouseId] })],
);

export const documentTypes = pgTable(
  "document_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    sign: integer("sign").notNull().default(1),
    movesStock: boolean("moves_stock").notNull().default(false),
    stockFactor: integer("stock_factor").notNull().default(0),
    movesAccount: boolean("moves_account").notNull().default(false),
    accountSide: text("account_side"),
    movesCash: boolean("moves_cash").notNull().default(false),
    cashDirection: text("cash_direction"),
    movesVat: boolean("moves_vat").notNull().default(false),
    electronic: boolean("electronic").notNull().default(false),
    afipCodes: jsonb("afip_codes").$type<Record<string, number>>().notNull().default({}),
    nextNumber: integer("next_number").notNull().default(1),
    active: boolean("active").notNull().default(true),
  },
  (table) => [unique("document_types_company_code").on(table.companyId, table.code)],
);

export const cashAccounts = pgTable("cash_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  active: boolean("active").notNull().default(true),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  kind: text("kind").notNull(),
  documentTypeId: uuid("document_type_id").notNull(),
  letter: text("letter"),
  pointOfSale: integer("point_of_sale").notNull(),
  number: integer("number").notNull(),
  issuedOn: date("issued_on", { mode: "string" }).notNull(),
  partyType: text("party_type").notNull(),
  partyId: uuid("party_id"),
  partyName: text("party_name").notNull(),
  partyCuit: text("party_cuit"),
  partyTaxCondition: text("party_tax_condition"),
  priceListId: uuid("price_list_id"),
  warehouseId: uuid("warehouse_id"),
  paymentMethod: text("payment_method").notNull().default("cuenta_corriente"),
  priceMode: text("price_mode").notNull(),
  status: text("status").notNull().default("confirmado"),
  notes: text("notes"),
  sourceDocumentId: uuid("source_document_id"),
  supplierPos: integer("supplier_pos"),
  supplierNumber: integer("supplier_number"),
  netTaxedCents: bigint("net_taxed_cents", { mode: "number" }).notNull(),
  netUntaxedCents: bigint("net_untaxed_cents", { mode: "number" }).notNull(),
  exemptCents: bigint("exempt_cents", { mode: "number" }).notNull(),
  vatCents: bigint("vat_cents", { mode: "number" }).notNull(),
  perceptionsCents: bigint("perceptions_cents", { mode: "number" }).notNull(),
  otherTaxesCents: bigint("other_taxes_cents", { mode: "number" }).notNull(),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  cae: text("cae"),
  caeDue: date("cae_due", { mode: "string" }),
  caeStatus: text("cae_status").notNull().default("no_electronico"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  voidedBy: uuid("voided_by"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentLines = pgTable("document_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  documentId: uuid("document_id").notNull(),
  position: integer("position").notNull(),
  productId: uuid("product_id"),
  sku: text("sku"),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3, mode: "number" }).notNull(),
  unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
  discountBps: integer("discount_bps").notNull().default(0),
  ivaRateBps: integer("iva_rate_bps").notNull().default(0),
  taxTreatment: text("tax_treatment").notNull().default("gravado"),
  netCents: bigint("net_cents", { mode: "number" }).notNull(),
  vatCents: bigint("vat_cents", { mode: "number" }).notNull(),
  exemptCents: bigint("exempt_cents", { mode: "number" }).notNull(),
  untaxedCents: bigint("untaxed_cents", { mode: "number" }).notNull(),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
});

export const documentTaxes = pgTable("document_taxes", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  documentId: uuid("document_id").notNull(),
  name: text("name").notNull(),
  rateBps: integer("rate_bps").notNull(),
  baseCents: bigint("base_cents", { mode: "number" }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
});

export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  productId: uuid("product_id").notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3, mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  documentId: uuid("document_id"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cashMovements = pgTable("cash_movements", {
  businessOperationId: uuid("business_operation_id"),
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  cashAccountId: uuid("cash_account_id").notNull(),
  documentId: uuid("document_id"),
  direction: text("direction").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  description: text("description").notNull(),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerAccounts = pgTable("ledger_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  parentCode: text("parent_code"),
  imputable: boolean("imputable").notNull().default(true),
  kind: text("kind").notNull(),
});

export const currentAccountEntries = pgTable("current_account_entries", {
  businessOperationId: uuid("business_operation_id"),
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  partyType: text("party_type").notNull(),
  partyId: uuid("party_id").notNull(),
  documentId: uuid("document_id"),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(),
  description: text("description").notNull(),
  debitCents: bigint("debit_cents", { mode: "number" }).notNull().default(0),
  creditCents: bigint("credit_cents", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customFieldDefs = pgTable("custom_field_defs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  entity: text("entity").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  fieldType: text("field_type").notNull(),
  required: boolean("required").notNull().default(false),
  options: jsonb("options").$type<string[]>().notNull().default([]),
  position: integer("position").notNull().default(0),
});

export const customFieldValues = pgTable("custom_field_values", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  fieldId: uuid("field_id").notNull(),
  recordId: uuid("record_id").notNull(),
  value: text("value").notNull().default(""),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  userId: uuid("user_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  summary: text("summary").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

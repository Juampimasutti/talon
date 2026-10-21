CREATE TABLE estate_properties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 address text NOT NULL, kind text NOT NULL CHECK(kind IN ('casa','depto','local','lote')),
 owner_customer_id uuid NOT NULL REFERENCES customers(id), owner_supplier_id uuid NOT NULL REFERENCES suppliers(id),
 status text NOT NULL DEFAULT 'disponible' CHECK(status IN ('disponible','alquilada','vendida','reservada')),
 notes text NOT NULL DEFAULT '', UNIQUE(id,company_id)
);
CREATE TABLE estate_contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 property_id uuid NOT NULL, owner_customer_id uuid NOT NULL REFERENCES customers(id), owner_supplier_id uuid NOT NULL REFERENCES suppliers(id), tenant_id uuid NOT NULL REFERENCES customers(id), starts_on date NOT NULL, ends_on date NOT NULL,
 initial_rent_cents bigint NOT NULL CHECK(initial_rent_cents>0), current_rent_cents bigint NOT NULL CHECK(current_rent_cents>0),
 adjustment_method text NOT NULL CHECK(adjustment_method IN ('manual','fijo','ICL','IPC')),
 adjustment_months integer NOT NULL CHECK(adjustment_months BETWEEN 1 AND 36), fixed_adjustment_bps integer,
 commission_bps integer NOT NULL DEFAULT 0 CHECK(commission_bps BETWEEN 0 AND 10000),
 commission_vat_bps integer NOT NULL DEFAULT 0 CHECK(commission_vat_bps IN (0,1050,2100,2700)),
 late_daily_bps integer NOT NULL DEFAULT 0 CHECK(late_daily_bps BETWEEN 0 AND 10000), grace_days integer NOT NULL DEFAULT 0 CHECK(grace_days BETWEEN 0 AND 60),
 deposit_cents bigint NOT NULL DEFAULT 0 CHECK(deposit_cents>=0), due_day integer NOT NULL CHECK(due_day BETWEEN 1 AND 28),
 guarantors jsonb NOT NULL DEFAULT '[]', status text NOT NULL DEFAULT 'activo' CHECK(status IN ('activo','finalizado')),
 last_adjustment_on date NOT NULL, CHECK(ends_on>=starts_on), FOREIGN KEY(property_id,company_id) REFERENCES estate_properties(id,company_id), UNIQUE(id,company_id)
);
CREATE TABLE estate_adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 contract_id uuid NOT NULL, effective_on date NOT NULL, old_cents bigint NOT NULL, new_cents bigint NOT NULL,
 coefficient numeric(18,8) NOT NULL, source text NOT NULL, UNIQUE(contract_id,effective_on),
 FOREIGN KEY(contract_id,company_id) REFERENCES estate_contracts(id,company_id)
);
CREATE TABLE estate_charges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 contract_id uuid NOT NULL, period text NOT NULL CHECK(period ~ '^\d{4}-\d{2}$'), due_on date NOT NULL,
 rent_cents bigint NOT NULL CHECK(rent_cents>0), extras_cents bigint NOT NULL CHECK(extras_cents>=0),
 expenses_cents bigint NOT NULL DEFAULT 0, taxes_cents bigint NOT NULL DEFAULT 0, services_cents bigint NOT NULL DEFAULT 0,
 penalty_cents bigint NOT NULL DEFAULT 0, notes text NOT NULL DEFAULT '',
 UNIQUE(contract_id,period), FOREIGN KEY(contract_id,company_id) REFERENCES estate_contracts(id,company_id), UNIQUE(id,company_id)
);
CREATE TABLE estate_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 charge_id uuid NOT NULL, commission_bps integer NOT NULL, commission_vat_bps integer NOT NULL, document_id uuid NOT NULL REFERENCES documents(id), rent_cents bigint NOT NULL CHECK(rent_cents>=0),
 extras_cents bigint NOT NULL CHECK(extras_cents>=0), occurred_on date NOT NULL,
 FOREIGN KEY(charge_id,company_id) REFERENCES estate_charges(id,company_id), UNIQUE(id,company_id)
);
CREATE TABLE estate_settlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 receipt_id uuid NOT NULL UNIQUE, owner_customer_id uuid NOT NULL REFERENCES customers(id), owner_supplier_id uuid NOT NULL REFERENCES suppliers(id),
 collected_cents bigint NOT NULL, commission_cents bigint NOT NULL, commission_total_cents bigint NOT NULL,
 expenses_cents bigint NOT NULL, payable_cents bigint NOT NULL CHECK(payable_cents>=0),
 invoice_id uuid REFERENCES documents(id), paid_on date,
 FOREIGN KEY(receipt_id,company_id) REFERENCES estate_receipts(id,company_id)
);
CREATE TABLE estate_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 property_id uuid NOT NULL, filename text NOT NULL, mime text NOT NULL, content_base64 text NOT NULL,
 FOREIGN KEY(property_id,company_id) REFERENCES estate_properties(id,company_id)
);
CREATE TABLE estate_sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 property_id uuid NOT NULL, buyer_id uuid NOT NULL REFERENCES customers(id), price_cents bigint NOT NULL CHECK(price_cents>0),
 stage text NOT NULL DEFAULT 'reserva' CHECK(stage IN ('reserva','sena','boleto','escritura','cancelada')),
 commission_cents bigint NOT NULL DEFAULT 0 CHECK(commission_cents>=0), commission_vat_bps integer NOT NULL DEFAULT 0,
 commission_party_id uuid NOT NULL REFERENCES customers(id), commission_invoice_id uuid REFERENCES documents(id),
 deposit_receipt_id uuid REFERENCES documents(id), notes text NOT NULL DEFAULT '',
 FOREIGN KEY(property_id,company_id) REFERENCES estate_properties(id,company_id)
);
CREATE INDEX estate_contract_dates ON estate_contracts(company_id,status,ends_on);
CREATE INDEX estate_receipts_charge ON estate_receipts(charge_id);
CREATE INDEX estate_charges_due ON estate_charges(company_id,due_on);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['estate_properties','estate_contracts','estate_adjustments','estate_charges','estate_receipts','estate_settlements','estate_attachments','estate_sales'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
 EXECUTE format('CREATE POLICY estate_select ON %I FOR SELECT USING(company_id=app_company_id() AND app_has_permission(''inmobiliaria.ver''))',tbl);
 EXECUTE format('CREATE POLICY estate_insert ON %I FOR INSERT WITH CHECK(company_id=app_company_id() AND app_has_permission(''inmobiliaria.crear''))',tbl);
 EXECUTE format('CREATE POLICY estate_update ON %I FOR UPDATE USING(company_id=app_company_id() AND app_has_permission(''inmobiliaria.editar'')) WITH CHECK(company_id=app_company_id() AND app_has_permission(''inmobiliaria.editar''))',tbl);
 EXECUTE format('CREATE TRIGGER lifecycle_write_gate BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION company_write_gate()',tbl);
 EXECUTE format('CREATE TRIGGER lifecycle_statement_gate BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION company_statement_gate()',tbl);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO talon_app',tbl);
 END LOOP;
END $$;
-- Un recibo ya liquidado no puede revertirse por fuera del circuito inmobiliario.
CREATE FUNCTION estate_document_is_settled(doc_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.estate_settlements s JOIN public.estate_receipts r ON r.id=s.receipt_id WHERE s.company_id=public.app_company_id() AND (s.invoice_id=doc_id OR r.document_id=doc_id))
$$;
REVOKE ALL ON FUNCTION estate_document_is_settled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION estate_document_is_settled(uuid) TO talon_app;

CREATE TABLE construction_works (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 name text NOT NULL,customer_id uuid NOT NULL REFERENCES customers(id),location text NOT NULL,starts_on date NOT NULL,ends_on date NOT NULL,
 status text NOT NULL DEFAULT 'activa' CHECK(status IN ('planificada','activa','pausada','finalizada')),responsible text NOT NULL,
 warehouse_id uuid NOT NULL REFERENCES warehouses(id),repair_bps integer NOT NULL DEFAULT 500 CHECK(repair_bps BETWEEN 0 AND 10000),
 vat_bps integer NOT NULL DEFAULT 2100 CHECK(vat_bps IN (0,1050,2100,2700)),cac_base_month text,cac_base_index numeric(18,6),cac_lag_months integer NOT NULL DEFAULT 0 CHECK(cac_lag_months BETWEEN 0 AND 12),
 CHECK(ends_on>=starts_on),UNIQUE(id,company_id)
);
CREATE TABLE construction_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 work_id uuid NOT NULL,rubro text NOT NULL,description text NOT NULL,kind text NOT NULL CHECK(kind IN ('material','mano_obra','subcontrato')),
 quantity_milli bigint NOT NULL CHECK(quantity_milli>0),unit_price_cents bigint NOT NULL CHECK(unit_price_cents>0),global_item boolean NOT NULL DEFAULT false,
 additional boolean NOT NULL DEFAULT false,certified_cents bigint NOT NULL DEFAULT 0,certified_quantity_milli bigint NOT NULL DEFAULT 0,certified_bps integer NOT NULL DEFAULT 0,
 FOREIGN KEY(work_id,company_id) REFERENCES construction_works(id,company_id),UNIQUE(id,company_id)
);
CREATE TABLE construction_certificates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 work_id uuid NOT NULL,period text NOT NULL,issued_on date NOT NULL,invoice_id uuid NOT NULL REFERENCES documents(id),
 base_cents bigint NOT NULL,adjustment_cents bigint NOT NULL,advance_returned_cents bigint NOT NULL,repair_cents bigint NOT NULL,tax_base_cents bigint NOT NULL,vat_cents bigint NOT NULL,total_cents bigint NOT NULL,progress_bps integer NOT NULL,
 cac_month text,cac_index numeric(18,6),cac_source text NOT NULL DEFAULT '',notes text NOT NULL DEFAULT '',
 FOREIGN KEY(work_id,company_id) REFERENCES construction_works(id,company_id),UNIQUE(work_id,period),UNIQUE(id,company_id)
);
CREATE TABLE construction_certificate_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 certificate_id uuid NOT NULL,item_id uuid NOT NULL,cumulative_cents bigint NOT NULL,period_cents bigint NOT NULL,
 cumulative_quantity_milli bigint NOT NULL,cumulative_bps integer NOT NULL,
 FOREIGN KEY(certificate_id,company_id) REFERENCES construction_certificates(id,company_id),FOREIGN KEY(item_id,company_id) REFERENCES construction_items(id,company_id)
);
CREATE TABLE construction_advances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 work_id uuid NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0),receipt_id uuid NOT NULL REFERENCES documents(id),
 FOREIGN KEY(work_id,company_id) REFERENCES construction_works(id,company_id)
);
CREATE TABLE construction_collections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 certificate_id uuid NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0),receipt_id uuid NOT NULL REFERENCES documents(id),
 FOREIGN KEY(certificate_id,company_id) REFERENCES construction_certificates(id,company_id)
);
CREATE TABLE construction_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 work_id uuid NOT NULL UNIQUE,amount_cents bigint NOT NULL,invoice_id uuid NOT NULL REFERENCES documents(id),
 FOREIGN KEY(work_id,company_id) REFERENCES construction_works(id,company_id)
);
CREATE TABLE construction_subcontracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 work_id uuid NOT NULL,supplier_id uuid NOT NULL REFERENCES suppliers(id),description text NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0),retention_bps integer NOT NULL DEFAULT 0 CHECK(retention_bps BETWEEN 0 AND 10000),
 FOREIGN KEY(work_id,company_id) REFERENCES construction_works(id,company_id),UNIQUE(id,company_id)
);
CREATE TABLE construction_subcertificates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 subcontract_id uuid NOT NULL,period text NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0),retained_cents bigint NOT NULL,
 FOREIGN KEY(subcontract_id,company_id) REFERENCES construction_subcontracts(id,company_id),UNIQUE(subcontract_id,period),UNIQUE(id,company_id)
);
CREATE TABLE construction_costs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 work_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('material','mano_obra','subcontrato','gasto')),description text NOT NULL,
 amount_cents bigint NOT NULL CHECK(amount_cents>0),occurred_on date NOT NULL,purchase_id uuid REFERENCES documents(id),subcertificate_id uuid UNIQUE REFERENCES construction_subcertificates(id),
 FOREIGN KEY(work_id,company_id) REFERENCES construction_works(id,company_id)
);
CREATE TABLE construction_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 work_id uuid NOT NULL,document_id uuid NOT NULL REFERENCES documents(id),FOREIGN KEY(work_id,company_id) REFERENCES construction_works(id,company_id)
);
CREATE TABLE construction_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 work_id uuid NOT NULL,name text NOT NULL,price_cents bigint NOT NULL CHECK(price_cents>0),status text NOT NULL DEFAULT 'disponible' CHECK(status IN ('disponible','vendida')),
 FOREIGN KEY(work_id,company_id) REFERENCES construction_works(id,company_id),UNIQUE(work_id,name),UNIQUE(id,company_id)
);
CREATE TABLE construction_unit_contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 unit_id uuid NOT NULL UNIQUE,buyer_id uuid NOT NULL REFERENCES customers(id),price_cents bigint NOT NULL,adjustment_method text NOT NULL CHECK(adjustment_method IN ('manual','fijo','CAC','sin_ajuste')),fixed_bps integer NOT NULL DEFAULT 0,
 FOREIGN KEY(unit_id,company_id) REFERENCES construction_units(id,company_id),UNIQUE(id,company_id)
);
CREATE TABLE construction_installments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 contract_id uuid NOT NULL,number integer NOT NULL,due_on date NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0),paid_cents bigint NOT NULL DEFAULT 0,index_value numeric(18,6),index_source text NOT NULL DEFAULT '',
 FOREIGN KEY(contract_id,company_id) REFERENCES construction_unit_contracts(id,company_id),UNIQUE(contract_id,number),UNIQUE(id,company_id)
);
CREATE TABLE construction_installment_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 installment_id uuid NOT NULL,receipt_id uuid NOT NULL REFERENCES documents(id),amount_cents bigint NOT NULL,
 FOREIGN KEY(installment_id,company_id) REFERENCES construction_installments(id,company_id)
);
CREATE TABLE construction_installment_adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 installment_id uuid NOT NULL,effective_month text NOT NULL,old_cents bigint NOT NULL,new_cents bigint NOT NULL,source text NOT NULL,
 FOREIGN KEY(installment_id,company_id) REFERENCES construction_installments(id,company_id),UNIQUE(installment_id,effective_month)
);
CREATE POLICY construction_budget_delete ON construction_items FOR DELETE USING(company_id=app_company_id() AND app_has_permission('constructora.anular'));
CREATE INDEX construction_costs_work ON construction_costs(company_id,work_id);
CREATE INDEX construction_certificates_work ON construction_certificates(company_id,work_id);
CREATE INDEX construction_installments_due ON construction_installments(company_id,due_on);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['construction_works','construction_items','construction_certificates','construction_certificate_lines','construction_advances','construction_collections','construction_releases','construction_subcontracts','construction_subcertificates','construction_costs','construction_transfers','construction_units','construction_unit_contracts','construction_installments','construction_installment_receipts','construction_installment_adjustments'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
 EXECUTE format('CREATE POLICY construction_select ON %I FOR SELECT USING(company_id=app_company_id() AND app_has_permission(''constructora.ver''))',tbl);
 EXECUTE format('CREATE POLICY construction_insert ON %I FOR INSERT WITH CHECK(company_id=app_company_id() AND app_has_permission(''constructora.crear''))',tbl);
 EXECUTE format('CREATE POLICY construction_update ON %I FOR UPDATE USING(company_id=app_company_id() AND app_has_permission(''constructora.editar'')) WITH CHECK(company_id=app_company_id() AND app_has_permission(''constructora.editar''))',tbl);
 EXECUTE format('CREATE TRIGGER lifecycle_write_gate BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION company_write_gate()',tbl);
 EXECUTE format('CREATE TRIGGER lifecycle_statement_gate BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION company_statement_gate()',tbl);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO talon_app',tbl);
 END LOOP;
END $$;
CREATE FUNCTION construction_document_is_linked(doc_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.construction_certificates WHERE company_id=public.app_company_id() AND invoice_id=doc_id)
 OR EXISTS(SELECT 1 FROM public.construction_advances WHERE company_id=public.app_company_id() AND receipt_id=doc_id)
 OR EXISTS(SELECT 1 FROM public.construction_collections WHERE company_id=public.app_company_id() AND receipt_id=doc_id)
 OR EXISTS(SELECT 1 FROM public.construction_releases WHERE company_id=public.app_company_id() AND invoice_id=doc_id)
 OR EXISTS(SELECT 1 FROM public.construction_installment_receipts WHERE company_id=public.app_company_id() AND receipt_id=doc_id)
$$;
REVOKE ALL ON FUNCTION construction_document_is_linked(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION construction_document_is_linked(uuid) TO talon_app;

-- Extender el vaciado a movimientos de obra, conservando presupuestos y maestros.
CREATE OR REPLACE FUNCTION company_destroy(token text, cid uuid, operation text, confirmation text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; company public.companies; payload jsonb; rows jsonb; tbl text; event_id uuid;
BEGIN
 actor:=public.lifecycle_actor(token);
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.memberships m JOIN public.roles r ON r.id=m.role_id WHERE m.user_id=actor AND m.company_id=cid AND m.active AND r.company_id=cid AND r.key='admin') THEN
   RAISE insufficient_privilege USING MESSAGE='Sólo el administrador de esta empresa puede hacer esto';
 END IF;
 IF operation NOT IN ('vaciar','eliminar') THEN RAISE EXCEPTION 'Operación inválida'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(cid::text,260026));
 SELECT * INTO company FROM public.companies WHERE id=cid FOR UPDATE;
 IF NOT FOUND OR confirmation IS DISTINCT FROM company.name THEN RAISE EXCEPTION 'Escribí el nombre exacto de la empresa' USING ERRCODE='22023'; END IF;
 -- Revalidar la membresía después de esperar el candado.
 IF NOT EXISTS(SELECT 1 FROM public.memberships m JOIN public.roles r ON r.id=m.role_id WHERE m.user_id=actor AND m.company_id=cid AND m.active AND r.key='admin' AND r.company_id=cid) THEN RAISE insufficient_privilege; END IF;
 payload:=jsonb_build_object('format','talon-company-backup-v1','createdAt',now(),'company',to_jsonb(company),'schemaMigrations',(SELECT jsonb_agg(id ORDER BY id) FROM public.schema_migrations));
 FOR tbl IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='company_id' ORDER BY table_name LOOP
   EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE company_id=$1',tbl) INTO rows USING cid;
   payload:=payload||jsonb_build_object(tbl,rows);
 END LOOP;
 payload:=payload||jsonb_build_object('role_permissions',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM public.role_permissions p JOIN public.roles r ON r.id=p.role_id WHERE r.company_id=cid),
 'import_rows',(SELECT coalesce(jsonb_agg(to_jsonb(ir)),'[]') FROM public.import_rows ir JOIN public.import_jobs ij ON ij.id=ir.job_id WHERE ij.company_id=cid),
 'userReferences',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'email',u.email)),'[]') FROM public.users u WHERE EXISTS(SELECT 1 FROM public.memberships m WHERE m.user_id=u.id AND m.company_id=cid)));
 INSERT INTO public.company_lifecycle_events(target_id,target_name,actor_id,action,backup) VALUES(cid,company.name,actor,operation,payload) RETURNING id INTO event_id;
 PERFORM set_config('app.lifecycle_company',cid::text,true);
 IF operation='eliminar' THEN
   DELETE FROM public.companies WHERE id=cid;
 ELSE
   FOREACH tbl IN ARRAY ARRAY['construction_installment_adjustments','construction_installment_receipts','construction_installments','construction_unit_contracts','construction_transfers','construction_costs','construction_subcertificates','construction_certificate_lines','construction_collections','construction_advances','construction_releases','construction_certificates','estate_settlements','estate_receipts','estate_charges','estate_sales','fuel_trip_events','fleet_vouchers','fuel_readings','fuel_payments','fuel_shop_lines','fuel_shifts','fuel_trips','fuel_deliveries','fuel_sticks','fuel_meter_resets','cash_movements','current_account_entries','stock_movements','stock_levels','document_taxes','document_lines','documents','sync_conflicts','import_jobs'] LOOP
     IF to_regclass('public.'||tbl) IS NOT NULL THEN EXECUTE format('DELETE FROM public.%I WHERE company_id=$1',tbl) USING cid; END IF;
   END LOOP;
   UPDATE public.construction_items SET certified_cents=0,certified_quantity_milli=0,certified_bps=0 WHERE company_id=cid;
   UPDATE public.construction_units SET status='disponible' WHERE company_id=cid;
   UPDATE public.fuel_compartments SET quantity=0 WHERE company_id=cid;
   -- No reutilizar numeración ni claves de sincronización ya procesadas.
   INSERT INTO public.audit_log(company_id,user_id,action,entity,entity_id,summary,metadata) VALUES(cid,actor,'empresa.vaciar','empresa',cid::text,'Datos operativos vaciados',jsonb_build_object('backupId',event_id));
 END IF;
 RETURN event_id;
END $$;

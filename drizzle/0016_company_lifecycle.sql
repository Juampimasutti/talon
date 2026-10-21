-- Gestión de empresas: autorización global separada del administrador de un tenant.
ALTER TABLE companies ADD COLUMN business_sector text NOT NULL DEFAULT 'comercio'
  CHECK (business_sector IN ('comercio','estacion','inmobiliaria','constructora'));
ALTER TABLE companies ADD COLUMN activity_started_on date;
CREATE TABLE demo_seed_updates (
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 version text NOT NULL, PRIMARY KEY(company_id,version)
);
ALTER TABLE demo_seed_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_seed_updates FORCE ROW LEVEL SECURITY;
REVOKE ALL ON demo_seed_updates FROM PUBLIC,talon_app;
CREATE TABLE company_operators (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('superadmin','estudio'))
);
CREATE TABLE company_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL,
  target_name text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('crear','vaciar','eliminar')),
  backup jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE company_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_operators FORCE ROW LEVEL SECURITY;
ALTER TABLE company_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_lifecycle_events FORCE ROW LEVEL SECURITY;

CREATE TABLE company_points_of_sale (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number integer NOT NULL CHECK (number BETWEEN 1 AND 99999),
  PRIMARY KEY (company_id, number)
);
INSERT INTO company_points_of_sale SELECT id, point_of_sale FROM companies;
INSERT INTO company_points_of_sale SELECT DISTINCT company_id,point_of_sale FROM documents ON CONFLICT DO NOTHING;
CREATE TABLE document_counters (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_type_id uuid NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
  point_of_sale integer NOT NULL,
  next_number integer NOT NULL DEFAULT 1 CHECK(next_number > 0),
  PRIMARY KEY(company_id,document_type_id,point_of_sale),
  FOREIGN KEY(company_id,point_of_sale) REFERENCES company_points_of_sale(company_id,number)
);
INSERT INTO document_counters
SELECT dt.company_id,dt.id,p.number,
  greatest(coalesce(max(d.number),0)+1,case when p.number=c.point_of_sale then dt.next_number else 1 end)
FROM document_types dt JOIN companies c ON c.id=dt.company_id
JOIN company_points_of_sale p ON p.company_id=dt.company_id
LEFT JOIN documents d ON d.document_type_id=dt.id AND d.point_of_sale=p.number
GROUP BY dt.company_id,dt.id,p.number,c.point_of_sale,dt.next_number;
ALTER TABLE company_points_of_sale ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_points_of_sale FORCE ROW LEVEL SECURITY;
CREATE POLICY points_select ON company_points_of_sale FOR SELECT USING(company_id=app_company_id());
CREATE POLICY points_insert ON company_points_of_sale FOR INSERT WITH CHECK(company_id=app_company_id() AND app_has_permission('configuracion.editar'));
ALTER TABLE document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY counters_select ON document_counters FOR SELECT USING(company_id=app_company_id());
CREATE POLICY counters_write ON document_counters FOR ALL
USING(company_id=app_company_id() AND (app_has_permission('comprobantes.editar') OR app_has_permission('ventas.crear') OR app_has_permission('compras.crear') OR app_has_permission('pedidos.crear') OR app_has_permission('remitos.crear') OR app_has_permission('cuentas_corrientes.crear')))
WITH CHECK(company_id=app_company_id() AND (app_has_permission('comprobantes.editar') OR app_has_permission('ventas.crear') OR app_has_permission('compras.crear') OR app_has_permission('pedidos.crear') OR app_has_permission('remitos.crear') OR app_has_permission('cuentas_corrientes.crear')));

CREATE FUNCTION lifecycle_actor(token text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT u.id FROM public.sessions s JOIN public.users u ON u.id=s.user_id
 WHERE s.token_hash=token AND s.expires_at>now() AND u.active
$$;
CREATE FUNCTION company_can_create(token text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_operators WHERE user_id=public.lifecycle_actor(token))
$$;
CREATE FUNCTION company_bootstrap(token text, data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; cid uuid; rid uuid;
BEGIN
 actor:=public.lifecycle_actor(token);
 IF actor IS NULL OR NOT public.company_can_create(token) THEN RAISE insufficient_privilege USING MESSAGE='Sólo estudio o superadmin puede crear empresas'; END IF;
 INSERT INTO public.companies(slug,name,legal_name,cuit,tax_condition,iibb,address,city,province,point_of_sale,enabled_modules,business_sector,activity_started_on,block_negative_stock)
 VALUES('empresa-'||gen_random_uuid(),data->>'name',data->>'legalName',data->>'cuit',data->>'taxCondition',data->>'iibb',data->>'address',data->>'city',data->>'province',(data->>'pointOfSale')::int,ARRAY(SELECT jsonb_array_elements_text(data->'enabledModules')),data->>'businessSector',nullif(data->>'activityStartedOn','')::date,true)
 RETURNING id INTO cid;
 INSERT INTO public.roles(company_id,key,name,description) VALUES(cid,'admin','Administración','Administrador de la empresa') RETURNING id INTO rid;
 INSERT INTO public.memberships(user_id,company_id,role_id) VALUES(actor,cid,rid);
 -- Sólo permisos dentro de la nueva empresa; esto no concede atribuciones globales.
 INSERT INTO public.role_permissions(role_id,permission) SELECT rid,jsonb_array_elements_text(data->'adminPermissions');
 INSERT INTO public.company_lifecycle_events(target_id,target_name,actor_id,action) VALUES(cid,data->>'name',actor,'crear');
 RETURN cid;
END $$;

-- Cada escritura toma un candado compartido por empresa. El respaldo y borrado
-- toman el exclusivo: no hay escritores concurrentes entre snapshot y borrado.
CREATE FUNCTION company_write_gate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' AND nullif(current_setting('app.lifecycle_company',true),'') IS NOT NULL AND OLD.company_id::text<>current_setting('app.lifecycle_company',true) THEN RAISE insufficient_privilege USING MESSAGE='El borrado afectaría datos de otra empresa'; END IF;
 IF TG_OP <> 'INSERT' THEN PERFORM pg_advisory_xact_lock_shared(hashtextextended(OLD.company_id::text,260026)); END IF;
 IF TG_OP <> 'DELETE' THEN
   IF TG_OP='INSERT' OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
     PERFORM pg_advisory_xact_lock_shared(hashtextextended(NEW.company_id::text,260026));
   END IF;
   RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
DO $$ DECLARE tbl text; BEGIN
 FOR tbl IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='company_id' LOOP
   EXECUTE format('CREATE TRIGGER lifecycle_write_gate BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.company_write_gate()',tbl);
 END LOOP;
END $$;

CREATE FUNCTION company_destroy(token text, cid uuid, operation text, confirmation text) RETURNS uuid
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
   FOREACH tbl IN ARRAY ARRAY['estate_settlements','estate_receipts','estate_charges','estate_sales','fuel_trip_events','fleet_vouchers','fuel_readings','fuel_payments','fuel_shop_lines','fuel_shifts','fuel_trips','fuel_deliveries','fuel_sticks','fuel_meter_resets','cash_movements','current_account_entries','stock_movements','stock_levels','document_taxes','document_lines','documents','sync_conflicts','import_jobs'] LOOP
     IF to_regclass('public.'||tbl) IS NOT NULL THEN EXECUTE format('DELETE FROM public.%I WHERE company_id=$1',tbl) USING cid; END IF;
   END LOOP;
   UPDATE public.fuel_compartments SET quantity=0 WHERE company_id=cid;
   -- No reutilizar numeración ni claves de sincronización ya procesadas.
   INSERT INTO public.audit_log(company_id,user_id,action,entity,entity_id,summary,metadata) VALUES(cid,actor,'empresa.vaciar','empresa',cid::text,'Datos operativos vaciados',jsonb_build_object('backupId',event_id));
 END IF;
 RETURN event_id;
END $$;
CREATE FUNCTION company_backups(token text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'companyId',target_id,'companyName',target_name,'action',action,'createdAt',created_at) ORDER BY created_at DESC),'[]')
 FROM public.company_lifecycle_events e WHERE actor_id=public.lifecycle_actor(token) AND backup IS NOT NULL
$$;
CREATE FUNCTION company_backup_download(token text, backup_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT backup FROM public.company_lifecycle_events WHERE id=backup_id AND actor_id=public.lifecycle_actor(token)
$$;
REVOKE ALL ON company_operators,company_lifecycle_events FROM PUBLIC,talon_app;
REVOKE ALL ON FUNCTION lifecycle_actor(text),company_can_create(text),company_bootstrap(text,jsonb),company_destroy(text,uuid,text,text),company_backups(text),company_backup_download(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION company_can_create(text),company_bootstrap(text,jsonb),company_destroy(text,uuid,text,text),company_backups(text),company_backup_download(text,uuid) TO talon_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON company_points_of_sale,document_counters TO talon_app;
GRANT EXECUTE ON FUNCTION lifecycle_actor(text) TO talon_app;
-- Los seeds y los cambios del punto predeterminado también registran el punto.
CREATE FUNCTION company_default_point() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.company_points_of_sale(company_id,number) VALUES(NEW.id,NEW.point_of_sale) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER company_default_point AFTER INSERT OR UPDATE OF point_of_sale ON companies FOR EACH ROW EXECUTE FUNCTION company_default_point();
-- Tomar el candado antes de adquirir filas para las escrituras de la aplicación.
CREATE FUNCTION company_statement_gate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE cid uuid;
BEGIN
 cid:=public.app_company_id();
 IF cid IS NOT NULL THEN PERFORM pg_advisory_xact_lock_shared(hashtextextended(cid::text,260026)); END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE tbl text; BEGIN
 FOR tbl IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='company_id' LOOP
   EXECUTE format('CREATE TRIGGER lifecycle_statement_gate BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.company_statement_gate()',tbl);
 END LOOP;
END $$;
CREATE TRIGGER lifecycle_statement_gate BEFORE INSERT OR UPDATE OR DELETE ON role_permissions FOR EACH STATEMENT EXECUTE FUNCTION company_statement_gate();
CREATE TRIGGER lifecycle_statement_gate BEFORE INSERT OR UPDATE OR DELETE ON import_rows FOR EACH STATEMENT EXECUTE FUNCTION company_statement_gate();
-- Una cuenta que eliminó su última empresa puede volver a entrar a sus respaldos.
CREATE FUNCTION company_user_has_backups(uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_lifecycle_events WHERE actor_id=uid AND backup IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION company_user_has_backups(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION company_user_has_backups(uuid) TO talon_app;

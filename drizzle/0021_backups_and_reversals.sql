-- Respaldos explícitos y diarios; no se reciben filas ni SQL del navegador.
ALTER TABLE company_lifecycle_events DROP CONSTRAINT company_lifecycle_events_action_check;
ALTER TABLE company_lifecycle_events ADD CONSTRAINT company_lifecycle_events_action_check
 CHECK(action IN ('crear','vaciar','eliminar','manual','automatico','antes_restaurar','restaurar'));
CREATE INDEX lifecycle_target_date ON company_lifecycle_events(target_id,created_at DESC);

CREATE FUNCTION company_snapshot(cid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE company public.companies; payload jsonb; rows jsonb; tbl text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(cid::text,260026));
 SELECT * INTO company FROM public.companies WHERE id=cid;
 IF NOT FOUND THEN RAISE EXCEPTION 'No encontramos la empresa' USING ERRCODE='22023'; END IF;
 payload:=jsonb_build_object('format','talon-company-backup-v1','createdAt',now(),'company',to_jsonb(company),'schemaMigrations',(SELECT jsonb_agg(id ORDER BY id) FROM public.schema_migrations));
 FOR tbl IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='company_id' ORDER BY table_name LOOP
   EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE company_id=$1',tbl) INTO rows USING cid;
   payload:=payload||jsonb_build_object(tbl,rows);
 END LOOP;
 RETURN payload||jsonb_build_object('role_permissions',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM public.role_permissions p JOIN public.roles r ON r.id=p.role_id WHERE r.company_id=cid),
 'import_rows',(SELECT coalesce(jsonb_agg(to_jsonb(ir)),'[]') FROM public.import_rows ir JOIN public.import_jobs ij ON ij.id=ir.job_id WHERE ij.company_id=cid),
 'userReferences',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'email',u.email)),'[]') FROM public.users u WHERE EXISTS(SELECT 1 FROM public.memberships m WHERE m.user_id=u.id AND m.company_id=cid)));
END $$;
CREATE FUNCTION company_is_admin(actor uuid,cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.memberships m JOIN public.roles r ON r.id=m.role_id JOIN public.users u ON u.id=m.user_id WHERE m.user_id=actor AND u.active AND m.active AND m.company_id=cid AND r.company_id=cid AND r.key='admin')
$$;
CREATE FUNCTION company_backup_create(token text,cid uuid,kind text DEFAULT 'manual') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; event_id uuid; payload jsonb;
BEGIN
 actor:=public.lifecycle_actor(token);
 IF NOT public.company_is_admin(actor,cid) THEN RAISE insufficient_privilege USING MESSAGE='Sólo el administrador puede guardar un respaldo completo'; END IF;
 IF kind NOT IN ('manual','automatico') THEN RAISE EXCEPTION 'Tipo de respaldo inválido' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(cid::text,260026));
 IF NOT public.company_is_admin(actor,cid) THEN RAISE insufficient_privilege; END IF;
 IF kind='automatico' THEN
   SELECT id INTO event_id FROM public.company_lifecycle_events WHERE target_id=cid AND action='automatico' AND created_at>now()-interval '24 hours' ORDER BY created_at DESC LIMIT 1;
   IF FOUND THEN RETURN event_id; END IF;
 END IF;
 payload:=public.company_snapshot(cid);
 INSERT INTO public.company_lifecycle_events(target_id,target_name,actor_id,action,backup) VALUES(cid,payload->'company'->>'name',actor,kind,payload) RETURNING id INTO event_id;
 INSERT INTO public.audit_log(company_id,user_id,action,entity,entity_id,summary,metadata) VALUES(cid,actor,'empresa.respaldar','empresa',cid::text,'Respaldo completo guardado',jsonb_build_object('backupId',event_id,'kind',kind));
 RETURN event_id;
END $$;
CREATE OR REPLACE FUNCTION company_backups(token text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'companyId',target_id,'companyName',target_name,'action',action,'createdAt',created_at,'canRestore',actor_id=public.lifecycle_actor(token) OR public.company_is_admin(public.lifecycle_actor(token),target_id)) ORDER BY created_at DESC),'[]')
 FROM public.company_lifecycle_events e WHERE backup IS NOT NULL AND (actor_id=public.lifecycle_actor(token) OR public.company_is_admin(public.lifecycle_actor(token),target_id))
$$;
CREATE OR REPLACE FUNCTION company_backup_download(token text,backup_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT backup FROM public.company_lifecycle_events WHERE id=backup_id AND (actor_id=public.lifecycle_actor(token) OR public.company_is_admin(public.lifecycle_actor(token),target_id))
$$;
CREATE FUNCTION company_backup_restore(token text,backup_id uuid,confirmation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; event public.company_lifecycle_events; cid uuid; current_name text; payload jsonb; before_id uuid; pending text[]; tbl text; rows jsonb; rid uuid; ceilings jsonb;
BEGIN
 actor:=public.lifecycle_actor(token);
 SELECT * INTO event FROM public.company_lifecycle_events WHERE id=backup_id AND backup IS NOT NULL;
 IF actor IS NULL OR NOT FOUND OR NOT(actor=event.actor_id OR public.company_is_admin(actor,event.target_id)) THEN RAISE insufficient_privilege; END IF;
 cid:=event.target_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(cid::text,260026));
 SELECT name INTO current_name FROM public.companies WHERE id=cid FOR UPDATE;
 IF FOUND AND NOT public.company_is_admin(actor,cid) THEN RAISE insufficient_privilege USING MESSAGE='Sólo el administrador actual puede reemplazar la empresa'; END IF;
 IF confirmation IS DISTINCT FROM coalesce(current_name,event.target_name) THEN RAISE EXCEPTION 'Escribí el nombre exacto de la empresa' USING ERRCODE='22023'; END IF;
 payload:=event.backup;
 IF payload->'schemaMigrations' IS DISTINCT FROM (SELECT jsonb_agg(id ORDER BY id) FROM public.schema_migrations) THEN
   RAISE EXCEPTION 'Este respaldo es de otra versión. Requiere una recuperación técnica; no se modificaron los datos.' USING ERRCODE='22023';
 END IF;
 IF current_name IS NOT NULL THEN
   INSERT INTO public.company_lifecycle_events(target_id,target_name,actor_id,action,backup) VALUES(cid,current_name,actor,'antes_restaurar',public.company_snapshot(cid)) RETURNING id INTO before_id;
 END IF;
 -- Conservar el techo de numeración conocido, incluso al recuperar un respaldo anterior.
 SELECT coalesce(jsonb_agg(jsonb_build_object('code',code,'point',point,'next',next)),'[]') INTO ceilings FROM (
   SELECT dt->>'code' as code,(c->>'point_of_sale')::int as point,max((c->>'next_number')::int) as next
   FROM public.company_lifecycle_events e CROSS JOIN LATERAL jsonb_array_elements(e.backup->'document_counters') c
   JOIN LATERAL jsonb_array_elements(e.backup->'document_types') dt ON dt->>'id'=c->>'document_type_id'
   WHERE e.target_id=cid AND e.backup IS NOT NULL GROUP BY dt->>'code',(c->>'point_of_sale')::int
 ) q;
 PERFORM set_config('app.lifecycle_company',cid::text,true);
 DELETE FROM public.companies WHERE id=cid;
 INSERT INTO public.companies SELECT * FROM jsonb_populate_record(null::public.companies,payload->'company');
 SELECT array_agg(table_name::text) INTO pending FROM information_schema.columns WHERE table_schema='public' AND column_name='company_id';
 pending:=pending||ARRAY['role_permissions','import_rows'];
 WHILE cardinality(pending)>0 LOOP
   SELECT candidate INTO tbl FROM unnest(pending) candidate WHERE NOT EXISTS(
     SELECT 1 FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_namespace n ON n.oid=child.relnamespace
     WHERE c.contype='f' AND n.nspname='public' AND child.relname=candidate AND parent.relname<>candidate AND parent.relname=ANY(pending)
   ) LIMIT 1;
   IF tbl IS NULL THEN RAISE EXCEPTION 'Dependencias no soportadas; no se restauró la empresa'; END IF;
   rows:=coalesce(payload->tbl,'[]');
   IF jsonb_array_length(rows)>0 THEN
     EXECUTE format('INSERT INTO public.%I SELECT * FROM jsonb_populate_recordset(null::public.%I,$1)%s',tbl,tbl,CASE WHEN tbl='company_points_of_sale' THEN ' ON CONFLICT DO NOTHING' ELSE '' END) USING rows;
   END IF;
   pending:=array_remove(pending,tbl);
 END LOOP;
 -- La recuperación no reactiva colaboradores ni usuarios revocados.
 UPDATE public.memberships SET active=false WHERE company_id=cid;
 SELECT id INTO rid FROM public.roles WHERE company_id=cid AND key='admin';
 IF rid IS NULL THEN RAISE EXCEPTION 'El respaldo no contiene el puesto administrador'; END IF;
 INSERT INTO public.memberships(user_id,company_id,role_id,active) VALUES(actor,cid,rid,true) ON CONFLICT(user_id,company_id) DO UPDATE SET role_id=excluded.role_id,active=true;
 INSERT INTO public.company_points_of_sale(company_id,number) SELECT cid,(r->>'point')::int FROM jsonb_array_elements(ceilings) r ON CONFLICT DO NOTHING;
 INSERT INTO public.document_counters(company_id,document_type_id,point_of_sale,next_number)
 SELECT cid,dt.id,(r->>'point')::int,(r->>'next')::int FROM jsonb_array_elements(ceilings) r JOIN public.document_types dt ON dt.company_id=cid AND dt.code=r->>'code'
 ON CONFLICT(company_id,document_type_id,point_of_sale) DO UPDATE SET next_number=greatest(document_counters.next_number,excluded.next_number);
 UPDATE public.document_types dt SET next_number=greatest(dt.next_number,c.next_number) FROM public.document_counters c JOIN public.companies co ON co.id=c.company_id AND co.point_of_sale=c.point_of_sale WHERE dt.id=c.document_type_id AND dt.company_id=cid;
 INSERT INTO public.company_lifecycle_events(target_id,target_name,actor_id,action) VALUES(cid,payload->'company'->>'name',actor,'restaurar');
 INSERT INTO public.audit_log(company_id,user_id,action,entity,entity_id,summary,metadata) VALUES(cid,actor,'empresa.restaurar','empresa',cid::text,'Empresa recuperada desde respaldo. Revisar colaboradores antes de reactivarlos.',jsonb_build_object('backupId',backup_id,'beforeBackupId',before_id));
 RETURN cid;
END $$;
REVOKE ALL ON FUNCTION company_snapshot(uuid),company_is_admin(uuid,uuid),company_backup_create(text,uuid,text),company_backup_restore(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION company_backup_create(text,uuid,text),company_backup_restore(text,uuid,text) TO talon_app;

-- Historial inmutable de reversiones de circuitos. Las filas operativas anuladas se
-- archivan aquí; comprobantes y movimientos compensatorios permanecen consultables.
CREATE TABLE business_reversals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 sector text NOT NULL CHECK(sector IN ('inmobiliaria','constructora')), resource text NOT NULL, operation_id uuid NOT NULL,
 reason text NOT NULL, snapshot jsonb NOT NULL, user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,sector,resource,operation_id)
);
CREATE INDEX reversals_company_date ON business_reversals(company_id,created_at DESC);
ALTER TABLE business_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_reversals FORCE ROW LEVEL SECURITY;
CREATE POLICY reversals_read ON business_reversals FOR SELECT USING(company_id=app_company_id() AND app_has_permission(sector||'.ver'));
CREATE POLICY reversals_insert ON business_reversals FOR INSERT WITH CHECK(company_id=app_company_id() AND app_has_permission(sector||'.anular'));
GRANT SELECT,INSERT ON business_reversals TO talon_app;
CREATE TRIGGER lifecycle_write_gate BEFORE INSERT OR UPDATE OR DELETE ON business_reversals FOR EACH ROW EXECUTE FUNCTION company_write_gate();
CREATE TRIGGER lifecycle_statement_gate BEFORE INSERT OR UPDATE OR DELETE ON business_reversals FOR EACH STATEMENT EXECUTE FUNCTION company_statement_gate();
ALTER TABLE current_account_entries ADD COLUMN business_operation_id uuid;
ALTER TABLE cash_movements ADD COLUMN business_operation_id uuid;
CREATE INDEX accounts_business_operation ON current_account_entries(company_id,business_operation_id) WHERE business_operation_id IS NOT NULL;
CREATE INDEX cash_business_operation ON cash_movements(company_id,business_operation_id) WHERE business_operation_id IS NOT NULL;
-- Sólo patrones internos exactos y operaciones existentes, no texto aportado por el usuario.
UPDATE current_account_entries e SET business_operation_id=s.id FROM estate_settlements s WHERE e.company_id=s.company_id AND (e.description='Liquidación propietario '||s.id::text OR e.description='Orden de pago inmobiliaria '||s.id::text);
UPDATE cash_movements e SET business_operation_id=s.id FROM estate_settlements s WHERE e.company_id=s.company_id AND e.description='Orden de pago inmobiliaria '||s.id::text;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['estate_settlements','estate_receipts','construction_advances','construction_collections','construction_certificate_lines','construction_certificates','construction_installment_receipts'] LOOP
   EXECUTE format('CREATE POLICY business_reverse_delete ON %I FOR DELETE USING(company_id=app_company_id() AND app_has_permission(%L))',tbl,CASE WHEN tbl LIKE 'estate_%%' THEN 'inmobiliaria.anular' ELSE 'constructora.anular' END);
 END LOOP;
END $$;

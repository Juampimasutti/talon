-- Los guards de numeración validan permisos con el contexto del actor autenticado.
CREATE OR REPLACE FUNCTION company_backup_restore(token text,backup_id uuid,confirmation text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; event public.company_lifecycle_events; cid uuid; current_name text; payload jsonb; before_id uuid; pending text[]; tbl text; rows jsonb; rid uuid; ceilings jsonb;
BEGIN
 actor:=public.lifecycle_actor(token);
 SELECT * INTO event FROM public.company_lifecycle_events WHERE id=backup_id AND backup IS NOT NULL;
 IF actor IS NULL OR NOT FOUND OR NOT(actor=event.actor_id OR public.company_is_admin(actor,event.target_id)) THEN RAISE insufficient_privilege; END IF;
 cid:=event.target_id;
 PERFORM set_config('app.company_id',cid::text,true);
 PERFORM set_config('app.user_id',actor::text,true);
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

CREATE OR REPLACE FUNCTION company_backups(token text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'companyId',target_id,'companyName',target_name,'restoreName',coalesce(c.name,target_name),'action',action,'createdAt',e.created_at,'canRestore',CASE WHEN c.id IS NULL THEN actor_id=public.lifecycle_actor(token) ELSE public.company_is_admin(public.lifecycle_actor(token),target_id) END) ORDER BY e.created_at DESC),'[]')
 FROM public.company_lifecycle_events e LEFT JOIN public.companies c ON c.id=e.target_id
 WHERE backup IS NOT NULL AND (actor_id=public.lifecycle_actor(token) OR public.company_is_admin(public.lifecycle_actor(token),target_id))
$$;

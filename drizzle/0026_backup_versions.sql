-- Después de actualizar, crear una copia compatible aunque ya exista una copia diaria anterior.
CREATE OR REPLACE FUNCTION company_backup_create(token text,cid uuid,kind text DEFAULT 'manual') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; event_id uuid; payload jsonb;
BEGIN
 actor:=public.lifecycle_actor(token);
 IF NOT public.company_is_admin(actor,cid) THEN RAISE insufficient_privilege USING MESSAGE='Sólo el administrador puede guardar un respaldo completo'; END IF;
 IF kind NOT IN ('manual','automatico') THEN RAISE EXCEPTION 'Tipo de respaldo inválido' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(cid::text,260026));
 IF NOT public.company_is_admin(actor,cid) THEN RAISE insufficient_privilege; END IF;
 IF kind='automatico' THEN
   SELECT id INTO event_id FROM public.company_lifecycle_events WHERE target_id=cid AND action='automatico' AND created_at>now()-interval '24 hours' AND backup->'schemaMigrations'=(SELECT jsonb_agg(id ORDER BY id) FROM public.schema_migrations) ORDER BY created_at DESC LIMIT 1;
   IF FOUND THEN RETURN event_id; END IF;
 END IF;
 payload:=public.company_snapshot(cid);
 INSERT INTO public.company_lifecycle_events(target_id,target_name,actor_id,action,backup) VALUES(cid,payload->'company'->>'name',actor,kind,payload) RETURNING id INTO event_id;
 INSERT INTO public.audit_log(company_id,user_id,action,entity,entity_id,summary,metadata) VALUES(cid,actor,'empresa.respaldar','empresa',cid::text,'Respaldo completo guardado',jsonb_build_object('backupId',event_id,'kind',kind));
 RETURN event_id;
END $$;
CREATE OR REPLACE FUNCTION company_backups(token text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'companyId',target_id,'companyName',target_name,'restoreName',coalesce(c.name,target_name),'action',action,'createdAt',e.created_at,'compatible',backup->'schemaMigrations'=(SELECT jsonb_agg(id ORDER BY id) FROM public.schema_migrations),'canRestore',CASE WHEN c.id IS NULL THEN actor_id=public.lifecycle_actor(token) ELSE public.company_is_admin(public.lifecycle_actor(token),target_id) END) ORDER BY e.created_at DESC),'[]')
 FROM public.company_lifecycle_events e LEFT JOIN public.companies c ON c.id=e.target_id
 WHERE backup IS NOT NULL AND (actor_id=public.lifecycle_actor(token) OR public.company_is_admin(public.lifecycle_actor(token),target_id))
$$;

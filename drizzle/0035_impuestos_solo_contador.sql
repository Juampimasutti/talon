-- El módulo Impuestos queda reservado al puesto "contador" (roles.key = 'contador').
-- 1) Saca impuestos.* de cualquier otro puesto (Administración y puestos personalizados).
DELETE FROM role_permissions rp
USING roles r
WHERE r.id = rp.role_id AND r.key <> 'contador' AND rp.permission LIKE 'impuestos.%';

-- 2) El contador lleva el módulo completo.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
CROSS JOIN (VALUES ('impuestos.ver'),('impuestos.crear'),('impuestos.editar'),
                   ('impuestos.anular'),('impuestos.importar'),('impuestos.exportar')) AS p(permission)
WHERE r.key = 'contador'
ON CONFLICT DO NOTHING;

-- 3) La base rechaza otorgar impuestos.* a otro puesto, venga de donde venga.
CREATE OR REPLACE FUNCTION imp_permiso_solo_contador() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.permission LIKE 'impuestos.%'
     AND NOT EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND key = 'contador') THEN
    RAISE EXCEPTION 'Los permisos de Impuestos son exclusivos del puesto Contador'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS imp_permiso_solo_contador ON role_permissions;
CREATE TRIGGER imp_permiso_solo_contador
  BEFORE INSERT OR UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION imp_permiso_solo_contador();

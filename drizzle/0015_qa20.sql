-- Alta de usuarios sin chocar con la política de lectura (INSERT … RETURNING).
CREATE OR REPLACE FUNCTION auth_create_user(p_name text, p_email text, p_password_hash text, p_role_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  IF app_company_id() IS NULL OR NOT app_has_permission('configuracion.crear') THEN
    RAISE EXCEPTION 'No tenés permiso para sumar usuarios' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roles WHERE id = p_role_id AND company_id = app_company_id()) THEN
    RAISE EXCEPTION 'Ese puesto no es de esta empresa';
  END IF;
  INSERT INTO users (name, email, password_hash)
  VALUES (btrim(p_name), lower(btrim(p_email)), p_password_hash)
  RETURNING id INTO uid;
  INSERT INTO memberships (user_id, company_id, role_id)
  VALUES (uid, app_company_id(), p_role_id);
  RETURN uid;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talon_app') THEN
    GRANT EXECUTE ON FUNCTION auth_create_user(text, text, text, uuid) TO talon_app;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS customers_company_cuit_uidx
  ON customers (company_id, cuit)
  WHERE cuit IS NOT NULL AND btrim(cuit) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_company_cuit_uidx
  ON suppliers (company_id, cuit)
  WHERE cuit IS NOT NULL AND btrim(cuit) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS fuel_nozzles_pump_number_uidx
  ON fuel_nozzles (pump_id, number);

CREATE UNIQUE INDEX IF NOT EXISTS fuel_tanks_company_name_uidx
  ON fuel_tanks (company_id, lower(btrim(name)));

UPDATE fleet_vehicles
SET plate = upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g'))
WHERE plate IS DISTINCT FROM upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g'));

CREATE UNIQUE INDEX IF NOT EXISTS fleet_vehicles_company_plate_uidx
  ON fleet_vehicles (company_id, upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g')));

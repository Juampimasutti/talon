CREATE OR REPLACE FUNCTION auth_home_company(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM memberships m
  JOIN companies c ON c.id = m.company_id
  WHERE m.user_id = p_user_id AND m.active AND c.active
  ORDER BY c.created_at
  LIMIT 1
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talon_app') THEN
    GRANT EXECUTE ON FUNCTION auth_home_company(uuid) TO talon_app;
  END IF;
END $$;

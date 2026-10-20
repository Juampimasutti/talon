-- El playero y el chofer no tienen clientes.ver. Pueden leer solo lo que usan en la playa o en el reparto.
CREATE POLICY customers_select_flota ON customers FOR SELECT
  USING (
    company_id = app_company_id()
    AND app_has_permission('estacion.ver')
    AND (
      EXISTS (SELECT 1 FROM fleet_vehicles v WHERE v.customer_id = customers.id AND v.company_id = customers.company_id)
      OR EXISTS (SELECT 1 FROM fleet_drivers d WHERE d.customer_id = customers.id AND d.company_id = customers.company_id)
      OR EXISTS (SELECT 1 FROM fleet_vouchers f WHERE f.customer_id = customers.id AND f.company_id = customers.company_id)
    )
  );

CREATE POLICY customers_select_reparto ON customers FOR SELECT
  USING (company_id = app_company_id() AND app_has_permission('reparto.ver'));

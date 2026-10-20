DROP POLICY IF EXISTS stock_levels_select ON stock_levels;
CREATE POLICY stock_levels_select ON stock_levels FOR SELECT
  USING (
    company_id = app_company_id()
    AND (
      app_has_permission('stock.ver')
      OR app_has_permission('ventas.crear')
      OR app_has_permission('ventas.anular')
      OR app_has_permission('compras.crear')
      OR app_has_permission('compras.anular')
      OR app_has_permission('remitos.crear')
      OR app_has_permission('remitos.anular')
    )
  );

DROP POLICY IF EXISTS stock_movements_select ON stock_movements;
CREATE POLICY stock_movements_select ON stock_movements FOR SELECT
  USING (
    company_id = app_company_id()
    AND (
      app_has_permission('stock.ver')
      OR app_has_permission('ventas.crear')
      OR app_has_permission('ventas.anular')
      OR app_has_permission('compras.crear')
      OR app_has_permission('compras.anular')
      OR app_has_permission('remitos.crear')
      OR app_has_permission('remitos.anular')
    )
  );

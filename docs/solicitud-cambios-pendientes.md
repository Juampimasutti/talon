# Talón: cambios pendientes (para implementar)

Contexto: Next.js 16 + TypeScript + Postgres + Drizzle + RLS multiempresa. API centralizada en `src/server/dispatch.ts`. Hoy las empresas solo las crea `scripts/seed.ts`; `POST /api/empresa` solo cambia de empresa activa.

## 1. Alta de empresa (alta prioridad, bloquea el piloto)
- Pantalla en Configuración: "Nueva empresa".
- Campos: razón social, nombre de fantasía, CUIT (validar dígito verificador), condición IVA, IIBB, domicilio, inicio de actividades, puntos de venta.
- Elegir qué módulos se activan (estación, reparto, pedidos, contabilidad, etc.).
- Crear los datos base: tipos de comprobante, numeradores por punto de venta, caja inicial, roles y permisos por defecto, plan de cuentas básico opcional.
- Asignar como administrador al usuario que la crea, con opción de invitar a otro.
- Solo usuarios con permiso de superadmin o del estudio. Registrar en auditoría.
- Al crearla, cambiar a la empresa nueva.

## 2. Eliminar / vaciar empresa (alta)
- "Vaciar datos": borra comprobantes, movimientos, stock y caja, y conserva maestros y configuración.
- "Eliminar empresa": lo borra todo.
- Antes de cualquiera de las dos: backup completo automático descargable y confirmación escribiendo el nombre de la empresa.
- Solo administrador. Registrar en auditoría. Respetar RLS (no tocar otras empresas).

## 3. Contabilidad (media)
- Hoy el plan de cuentas existe pero nada se imputa.
- Generar asientos automáticos por factura, NC/ND, compra, cobro, pago y movimiento de caja, con cuentas configurables por tipo de operación.
- Mostrar libro diario y mayor.
- Exportar asientos en Excel/CSV/TXT, con un formato compatible con Account Soft si se puede.
- Si no se hace ahora: ocultar el módulo para que no confunda.

## 4. Seed demo (baja)
- La percepción IIBB del 3% en la mitad de los clientes RI de la demo puede confundir. Dejarla solo en 1 o 2 clientes y nombrarlos de forma que se note.

## 5. Rubro inmobiliaria (módulo activable, como Estación de servicio) (media)
- Se activa por empresa desde su configuración y solo entonces aparece en el menú y en los permisos por rol. Seguir el mismo patrón que el módulo estación.
- Propiedades: dirección, tipo (casa, depto, local, lote), propietario, estado (disponible, alquilada, vendida, reservada), fotos y documentación.
- Propietarios e inquilinos o compradores, vinculados a clientes y proveedores.
- Contratos de alquiler: fechas, valor inicial, actualización (ICL, IPC, porcentaje fijo o manual) y período de ajuste, depósito en garantía, garantes, vencimientos y renovaciones.
- Cobranza mensual: liquidación al inquilino (alquiler, expensas, impuestos y servicios a cargo), punitorios por mora, recibo.
- Liquidación al propietario: cobrado menos comisión de la inmobiliaria y gastos, con orden de pago.
- Ventas de propiedades: reserva, seña, boleto, escritura y comisión.
- Facturación de la comisión y honorarios con el facturador ARCA. Cuenta corriente de inquilinos y propietarios.
- Avisos de contratos por vencer y ajustes del mes.
- Informes: morosidad, propiedades vacantes, ingresos por comisión, liquidaciones pendientes.
- Empresa demo inmobiliaria con datos de prueba.

## 6. Rubro constructora (módulo activable) (media)
- Mismo mecanismo de activación por empresa y permisos.
- Obras o proyectos: cliente, ubicación, fechas, estado y responsable.
- Presupuesto por rubros e ítems (cómputo y presupuesto) con materiales, mano de obra y subcontratos.
- Certificados de avance de obra, con facturación por certificado y ajuste por índice (CAC) opcional.
- Costos reales por obra: compras de materiales imputadas a la obra, mano de obra, subcontratistas y gastos. Comparación entre presupuesto y real.
- Acopio de materiales y stock por obra o depósito, con remitos a obra.
- Subcontratistas: contratos, certificados y retenciones, si corresponde.
- Fondo de reparo y anticipos financieros.
- Venta de unidades o lotes de un desarrollo, con plan de cuotas ajustables y cuenta corriente del comprador.
- Informes: rentabilidad por obra, desvíos, certificado contra cobrado, cuotas a cobrar.
- Empresa demo constructora con datos de prueba.

## 7. Selección de rubro al dar de alta una empresa
- En el alta (punto 1) elegir el rubro: comercio general, estación de servicio, inmobiliaria o constructora. Eso preactiva los módulos que correspondan, y después se pueden prender o apagar a mano.

## Sin probar
- Factura electrónica con CAE y QR (la demo no emite electrónica).

## Criterios
- Agregar tests (vitest) para alta, vaciado y eliminación, incluyendo el aislamiento RLS.
- Nueva migración en `drizzle/` (la última es 0015_qa20.sql).
- Mantener el rendimiento: sin N+1, carga diferida.

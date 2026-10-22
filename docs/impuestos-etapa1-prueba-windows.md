# Prueba manual de Impuestos Etapa 1 en Windows

Esta verificación se ejecuta después de recibir el resultado pendiente de Fase P. No requiere cambiar el instalador.

1. Hacer un respaldo manual de la empresa y conservar el archivo fuera de la PC.
2. Actualizar una instalación de prueba, ejecutar las migraciones y comprobar que el módulo sigue oculto hasta habilitar `impuestos` en la empresa.
3. Habilitar el módulo y entrar con un rol administrador. Abrir los libros de Ventas y Compras y ejecutar “Traer de Talón” para un mes controlado.
4. Comparar cantidad y totales contra Ventas/Compras. Confirmar que esos módulos no cambiaron y que se puede seguir facturando y cobrando normalmente.
5. Importar ambos XLSX de `src/lib/impuestos/__fixtures__`. Repetir un archivo y comprobar que todas sus filas aparecen como duplicadas.
6. Importar primero con “Crear también en Talón” apagado y luego prendido en una empresa descartable. Verificar clientes/proveedores y ausencia de duplicados por CUIT.
7. Calcular septiembre de 2026 con el ejemplo del brief: debe dar $5.050,00. Confirmar, intentar editar el libro (debe bloquearse), reabrir con motivo y verificar el registro en Auditoría.
8. Generar los TXT y controlar que no cambien al repetir la exportación. La aceptación en el portal de ARCA sigue siendo una prueba externa separada.
9. Crear un respaldo con datos de impuestos, restaurarlo en la instalación de prueba y verificar libros, importaciones, liquidación y auditoría.

Registrar versión de Windows, Node, PostgreSQL y navegador, más capturas o el texto completo de cualquier error. Hasta completar estos pasos, Windows queda marcado **NO VERIFICADO**.

# Lista de verificación — VM Windows, Fase P

Completá esta lista en una VM limpia con datos ficticios. Adjuntá los mensajes
exactos y los JSON de la prueba de concurrencia cuando algo falle.

## Paquete y requisitos

- [ ] Windows 10 u 11 x64 limpio; versión anotada: __________
- [ ] Node portable 24.x arranca: `C:\Talon\node\node.exe --version` → __________
- [ ] El standalone se compiló en Windows con `npm run build:standalone`.
- [ ] Anotar si el build exigió Modo para desarrolladores o elevación: __________
- [ ] El paquete sigue arrancando después de copiarlo a `C:\Talon\app`.
- [ ] `C:\Talon\app` contiene `server.js`, `public`, `.next\static`, `drizzle` y los scripts compilados.
- [ ] El paquete no contiene `.env`, `.git`, datos reales ni certificados.
- [ ] PostgreSQL portable 16.x arranca: `postgres.exe --version` → __________
- [ ] ¿Pidió Microsoft Visual C++ Runtime? Sí / No. Mensaje: __________

## Base y comandos compilados

- [ ] `initdb` crea `C:\Talon\datos` sin ejecutarse como administrador.
- [ ] PostgreSQL escucha solo en `127.0.0.1:5433`.
- [ ] Existen la base `talon` y el rol `talon_app` sin superusuario ni `BYPASSRLS`.
- [ ] `migrate.js` se ejecuta desde `C:\Talon` y termina con “Migraciones al día”.
- [ ] Una segunda ejecución de `migrate.js` no reaplica migraciones.
- [ ] `empresa-autorizar.js usuario@... superadmin` funciona con un usuario existente.
- [ ] `backup-worker.js --once` crea al menos un JSON bajo `C:\Talon\respaldos`.

## Aplicación

- [ ] `run-standalone.mjs` responde en `http://localhost:4318/api/health`.
- [ ] Tiempo desde el comando hasta la primera respuesta: __________ segundos.
- [ ] Inicio de sesión y navegación básica funcionan en la PC servidor.
- [ ] Desde otra PC, `http://IP:4318/api/health` responde.
- [ ] Desde otra PC, el inicio de sesión por `http://IP:4318` funciona. Si falla, copiar consola/red: __________
- [ ] El firewall permite 4318 solo en red privada; 5433 no está abierto.

## Concurrencia

- [ ] Localhost: `prueba-doble-cobro.mjs ... 5 todas` completó las tres variantes.
- [ ] Resultado `anticipo`: únicos ___ / duplicados ___ / errores ___
- [ ] Resultado `recibo`: únicos ___ / duplicados ___ / errores ___
- [ ] Resultado `deuda-exacta`: únicos ___ / duplicados ___ / errores ___
- [ ] Desde otra PC: la misma prueba contra `http://IP:4318` completó.
- [ ] Se guardaron y adjuntaron los JSON de `C:\Talon\logs`.

## Reinicio y límites de esta fase

- [ ] Reiniciar Windows y confirmar que Talón **no arranca solo todavía**; en Fase P es el comportamiento esperado.
- [ ] Arrancar primero PostgreSQL y después la app manualmente; vuelve a responder.
- [ ] Probar arrancar la app antes que PostgreSQL y anotar el error/reintento observado: __________
- [ ] Confirmar que no se probaron datos reales ni integración ARCA.

Estado final de la VM: APROBADO / BLOQUEADO

Observaciones: ______________________________________________________________

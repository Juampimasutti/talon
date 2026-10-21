# Instalador guiado de Talón Demo para Windows

Este paquete prepara una demostración independiente en una sola PC. No requiere contratar una nube. No es un `.exe` autónomo: usa Node.js y Docker Desktop. El flujo de instalación, base de datos, compilación e ingreso se comprobó en Linux; los lanzadores `.cmd`, el acceso directo y la experiencia de Windows todavía requieren una prueba en Windows.

## Enviar a tu amigo

Descargá el ZIP del repositorio actualizado y mandale **ese ZIP original**, no la carpeta ya configurada en tu PC. Si el repositorio es privado, tu amigo puede recibir el archivo por el medio que uses habitualmente sin necesitar acceso a GitHub.

1. Instalar **Node.js 24 LTS**, incluyendo npm: <https://nodejs.org/>.
2. Instalar **Docker Desktop**: <https://www.docker.com/products/docker-desktop/>. Completar WSL y reinicios si los solicita; abrir Docker Desktop y esperar a que esté listo.
3. Extraer todo el ZIP en una carpeta nueva, por ejemplo `Documentos\TalonDemo`. No mezclarlo con otra instalación ni ejecutar archivos desde dentro del ZIP.
4. Doble clic en **`INSTALAR-TALON.cmd`**. La primera vez necesita internet para descargar PostgreSQL y dependencias. La compilación se realiza en esa PC y puede tardar varios minutos.
5. Al terminar, abrir **`ABRIR-TALON.cmd`** o el acceso directo **Talón Demo** que se crea en el escritorio. Se abre el navegador. Mantener la ventana del servidor abierta mientras se usa Talón.

Ingreso de demostración: **`laura@talon.demo`**, clave **`talon1234`**. Elegir **Inmobiliaria Demo** en el selector Empresa. Las propiedades, contratos y demás datos son ficticios. La cuenta obtiene autorización global de estudio para poder crear también una empresa de prueba propia del rubro inmobiliario.

El paquete incluye las otras empresas de demostración del proyecto. No emite comprobantes fiscales reales: **ARCA sigue pendiente**. No usarlo como registro oficial del negocio durante el piloto.

## Uso diario

Abrir Docker Desktop y luego **ABRIR-TALON**. No reinstalar cada día. Si Talón ya está abierto, el lanzador vuelve a indicar o abrir su dirección sin iniciar otro servidor. Para detenerlo, usar **Ctrl+C** en su ventana. PostgreSQL continúa conservando los datos en un volumen de Docker; no eliminar los volúmenes al cerrar.

Sólo escucha en `127.0.0.1`: esta demo no se publica en internet ni queda accesible desde otro equipo. El puerto web se elige a partir de 14317 y el de PostgreSQL a partir de 15432, buscando uno libre. La dirección concreta se imprime al abrir.

## Qué instala y qué conserva

- PostgreSQL 16 en un proyecto Docker independiente, con nombre aleatorio y volumen persistente propio.
- Credenciales de base de datos aleatorias en `.env.local`; la aplicación usa un rol sin superusuario. Las variables de entorno heredadas no pueden desviar las migraciones a otra base ni habilitar ARCA real.
- Dependencias del `package-lock.json`, migraciones existentes, datos ficticios, autorización de estudio para la cuenta demo y build de producción.
- Caché de descarga local `.talon-npm-cache`, estado `.talon-windows.json` y acceso directo en el escritorio. Si no se puede crear el acceso directo, el lanzador de la carpeta sigue disponible.
- Antes de migrar, una copia completa de PostgreSQL en `backups/instalador`. Este archivo `.dump` requiere recuperación técnica con PostgreSQL: no se importa desde la pantalla de respaldos JSON.
- Durante el uso se ejecuta el trabajador habitual de respaldos JSON. Se mantiene la retención de 14 automáticos por empresa y las copias manuales y previas a operaciones delicadas.

No sobrescribe una configuración `.env.local` ajena al instalador. Volver a ejecutar el instalador reutiliza su configuración y su base, sin comandos de borrado de volúmenes. Si el puerto de la app está ocupado, pide cerrarla antes de actualizar. Si una etapa falla, no presenta la instalación como terminada: muestra el error y permite volver a ejecutarla.

Guardar respaldos también fuera de esa PC. No compartir `.env.local`, `backups`, `.talon-windows.json`, caché ni la carpeta configurada. Cada PC debe instalar desde el ZIP original y tendrá datos independientes; no existe sincronización automática entre instalaciones.

## Si no arranca

- «Instalá Node.js»: completar la instalación oficial con npm y volver a abrir el lanzador.
- «Instalá y abrí Docker Desktop»: abrirlo, completar WSL/reinicios y esperar a que esté listo.
- «Esta carpeta ya tiene otra configuración»: extraer el ZIP en una carpeta nueva. No borrar la configuración anterior para forzar la instalación.
- Puerto ocupado: cerrar la ventana de esa demo con Ctrl+C. No detener otros programas ni eliminar volúmenes para liberar espacio.
- Si falla una descarga o el build: conservar la ventana/mensaje y volver a ejecutar INSTALAR después de resolver el problema. No mandar credenciales ni archivos de configuración para pedir ayuda.

El piloto inmobiliario recomendado sigue el circuito propiedad → contrato → alquiler → cobro → liquidación al propietario → pago. Verificar los importes por separado, imprimir y probar respaldo/recuperación antes de pasar a datos de trabajo. Las limitaciones inmobiliarias y de recuperación de las guías anteriores siguen vigentes.

## Verificación del paquete

- Sintaxis de los scripts Node y seis pruebas del instalador correctas.
- Instalación desde una copia limpia: Docker, npm ci, migraciones, rol restringido, seed, autorización global y build de producción completos.
- Reinstalación: mismos identificadores y cantidades de empresas (5), documentos (82), usuarios (10) y membresías (14).
- Arranque con salud de base correcta; ingreso de Laura y apertura de Inmobiliaria Demo en Chromium. Autorización para crear empresas comprobada.
- Copia `.dump` legible por `pg_restore --list`, incluyendo datos de empresas. Esto comprueba el formato; queda pendiente un ensayo completo de restauración de ese dump.
- Configuración ajena rechazada y conservada intacta; reapertura sin duplicar servidor y actualización con la app abierta bloqueada.
- Lint de los scripts nuevos sin errores. La app y su lógica comercial no se modifican en este paquete.

**Pendiente:** prueba en Windows de los `.cmd`, Docker Desktop/WSL, apertura automática del navegador, acceso directo y cierre del árbol de procesos. También impresión física y piloto del amigo. No se desplegó ni se conectó una base real.

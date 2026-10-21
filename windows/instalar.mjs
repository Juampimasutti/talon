import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { root, envFile, prerequisites, npmCli, run, freePort, validateConfig, loadConfig, childEnv, composeArgs, backupDatabase } from './comun.mjs';
async function main() {
  process.chdir(root);
  console.log('Talón · Instalación de demostración local. ARCA pendiente.');
  prerequisites();
  const npm = npmCli();
  let config;
  if (existsSync(envFile)) config = loadConfig();
  else {
    const admin = randomBytes(24).toString('hex'), app = randomBytes(24).toString('hex');
    const port = String(await freePort(15432));
    config = validateConfig({
      TALON_WINDOWS_DEMO: '1', TALON_WINDOWS_PROJECT: `talon-demo-${randomBytes(6).toString('hex')}`,
      TALON_WINDOWS_DB_PASSWORD: admin, TALON_WINDOWS_APP_PASSWORD: app,
      TALON_WINDOWS_DB_PORT: port, TALON_WINDOWS_HTTP_PORT: String(await freePort(14317)),
      DATABASE_URL_ADMIN: `postgres://talon_admin:${admin}@127.0.0.1:${port}/talon_amigo_demo`,
      DATABASE_URL: `postgres://talon_app:${app}@127.0.0.1:${port}/talon_amigo_demo`, ARCA_MODE: 'mock',
    });
    writeFileSync(envFile, Object.entries(config).map(([key,value]) => `${key}=${value}`).join('\n')+'\n', { flag: 'wx', mode: 0o600 });
  }
  if (await freePort(Number(config.TALON_WINDOWS_HTTP_PORT)) !== Number(config.TALON_WINDOWS_HTTP_PORT)) throw Error('El puerto de Talón Demo está ocupado. Cerrá su ventana con Ctrl+C antes de volver a instalar.');
  const env = childEnv(config);
  console.log('1/7 · Preparando PostgreSQL independiente (conserva los datos si se repite).');
  await run('docker', [...composeArgs(config), 'up', '-d', '--wait', '--wait-timeout', '120'], env);
  console.log('2/7 · Instalando dependencias. La primera vez requiere internet.');
  await run(process.execPath, [npm, 'ci', '--include=dev'], env);
  console.log('3/7 · Preparando la base de demostración.');
  await backupDatabase(config);
  await run(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], env);
  await run(process.execPath, ['windows/configurar-rol.mjs'], env);
  console.log('4/7 · Cargando datos ficticios.');
  await run(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], env);
  await run(process.execPath, ['--import', 'tsx', 'scripts/company-operator.ts', 'laura@talon.demo', 'estudio'], env);
  console.log('5/7 · Compilando para esta PC. Puede tardar varios minutos.');
  await run(process.execPath, [npm, 'run', 'build'], env);
  await run(process.execPath, ['scripts/shell-assets.mjs'], env);
  console.log('6/7 · Guardando estado de instalación.');
  writeFileSync(join(root, '.talon-windows.json'), JSON.stringify({ installedAt: new Date().toISOString(), project: config.TALON_WINDOWS_PROJECT }, null, 2), { mode: 0o600 });
  console.log('7/7 · Preparando acceso directo.');
  if (process.platform === 'win32') {
    const literal = value => "'"+value.replaceAll("'", "''")+"'";
    const code = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) ${literal('Talón Demo '+config.TALON_WINDOWS_PROJECT.slice(-6)+'.lnk')}));$s.TargetPath=${literal(join(root,'ABRIR-TALON.cmd'))};$s.WorkingDirectory=${literal(root)};$s.Save()`;
    try { await run('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(code,'utf16le').toString('base64')], env); }
    catch { console.log('No se pudo crear el acceso directo. Usá ABRIR-TALON.cmd desde la carpeta.'); }
  }
  console.log('\nInstalación terminada. Ejecutá ABRIR-TALON.cmd.\nIngreso: laura@talon.demo · Clave de demostración: talon1234\nElegí Inmobiliaria Demo en el selector de empresa. Sólo para pruebas locales.');
}
main().catch(error => { console.error('\nNo se completó la instalación:', error.message); process.exitCode = 1; });

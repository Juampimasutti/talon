import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, openSync, closeSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const envFile = join(root, '.env.local');
export function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.on('error', () => reject(Error(`No se pudo ejecutar ${command}. Revisá los requisitos.`)));
    child.on('exit', code => code === 0 ? resolve() : reject(Error(`La etapa ${args[0] ?? command} terminó con error (${code}). No se borraron los datos. Podés volver a intentarlo.`)));
  });
}
export function prerequisites() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Instalá Node.js 24 LTS desde https://nodejs.org/');
  try { execFileSync('docker', ['info'], { stdio: 'ignore' }); }
  catch { throw Error('Instalá y abrí Docker Desktop: https://www.docker.com/products/docker-desktop/ . Esperá a que esté iniciado y volvé a intentar.'); }
  try { execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' }); }
  catch { throw Error('Hace falta Docker Compose incluido en Docker Desktop.'); }
}
export function npmCli() {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
  if (process.platform !== 'win32') {
    try { candidates.push(execFileSync('which', ['npm'], { encoding: 'utf8' }).trim()); } catch {}
  }
  const file = candidates.find(file => file && existsSync(file));
  if (!file) throw Error('No se encuentra npm. Reinstalá Node.js con npm desde nodejs.org.');
  return file;
}
export function parseConfig(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
}
export function validateConfig(config) {
  if (config.TALON_WINDOWS_DEMO !== '1') throw Error('Esta carpeta ya tiene otra configuración. No se modificó. Extraé el paquete en una carpeta nueva para la demo.');
  for (const key of ['TALON_WINDOWS_DB_PASSWORD', 'TALON_WINDOWS_APP_PASSWORD'])
    if (!/^[a-f0-9]{48}$/.test(config[key] ?? '')) throw Error('La configuración de la demo está incompleta. Conservá la carpeta y solicitá asistencia.');
  if (!/^talon-demo-[a-f0-9]{12}$/.test(config.TALON_WINDOWS_PROJECT ?? '')) throw Error('Identificador de demo inválido.');
  for (const key of ['TALON_WINDOWS_DB_PORT', 'TALON_WINDOWS_HTTP_PORT'])
    if (!/^\d+$/.test(config[key] ?? '') || Number(config[key]) < 1024 || Number(config[key]) > 65535) throw Error('Puerto de demo inválido.');
  const expected = {
    DATABASE_URL_ADMIN: `postgres://talon_admin:${config.TALON_WINDOWS_DB_PASSWORD}@127.0.0.1:${config.TALON_WINDOWS_DB_PORT}/talon_amigo_demo`,
    DATABASE_URL: `postgres://talon_app:${config.TALON_WINDOWS_APP_PASSWORD}@127.0.0.1:${config.TALON_WINDOWS_DB_PORT}/talon_amigo_demo`,
  };
  for (const [key, value] of Object.entries(expected)) if (config[key] !== value) throw Error('La base configurada no corresponde a esta demo local. No se ejecutó ninguna migración.');
  return config;
}
export function loadConfig() {
  if (!existsSync(envFile)) throw Error('Primero ejecutá INSTALAR-TALON.cmd.');
  return validateConfig(parseConfig(readFileSync(envFile, 'utf8')));
}
export const childEnv = config => ({ ...process.env, ...config, ARCA_MODE: 'mock', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', TALON_BACKUP_DIR: join(root, 'backups'), npm_config_omit: '', npm_config_cache: join(root, '.talon-npm-cache') });
export const composeArgs = config => ['compose', '--env-file', envFile, '-p', config.TALON_WINDOWS_PROJECT, '-f', join(root, 'windows/compose.demo.yml')];
export async function freePort(start) {
  for (let port = start; port < start + 50; port++) {
    const available = await new Promise(resolve => { const server = createServer(); server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => server.close(() => resolve(true))); });
    if (available) return port;
  }
  throw Error('No se encontró un puerto disponible para la demo.');
}

export async function backupDatabase(config) {
  const folder=join(root,'backups','instalador');
  mkdirSync(folder,{recursive:true,mode:0o700});
  const target=join(folder,`antes-instalar-${new Date().toISOString().replaceAll(':','-')}-${randomUUID()}.dump`);
  const partial=target+'.partial';
  const descriptor=openSync(partial,'wx',0o600);
  try {
    await new Promise((resolve,reject)=>{
      const child=spawn('docker',[...composeArgs(config),'exec','-T','db','pg_dump','-U','talon_admin','-d','talon_amigo_demo','--format=custom'],{cwd:root,env:childEnv(config),stdio:['ignore',descriptor,'inherit']});
      child.on('error',()=>reject(Error('No se pudo iniciar el respaldo previo. No se ejecutaron migraciones.')));
      child.on('exit',code=>code===0?resolve():reject(Error('Falló el respaldo previo. No se ejecutaron migraciones.')));
    });
  } catch(error) { closeSync(descriptor);rmSync(partial,{force:true});throw error; }
  closeSync(descriptor);
  renameSync(partial,target);
  console.log('Respaldo previo guardado en backups/instalador (formato PostgreSQL, recuperación técnica).');
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { validateConfig, parseConfig, childEnv, freePort, composeArgs } from './comun.mjs';
const config = () => ({
  TALON_WINDOWS_DEMO:'1', TALON_WINDOWS_PROJECT:'talon-demo-123456abcdef',
  TALON_WINDOWS_DB_PASSWORD:'a'.repeat(48), TALON_WINDOWS_APP_PASSWORD:'b'.repeat(48),
  TALON_WINDOWS_DB_PORT:'15432', TALON_WINDOWS_HTTP_PORT:'14317',
  DATABASE_URL_ADMIN:`postgres://talon_admin:${'a'.repeat(48)}@127.0.0.1:15432/talon_amigo_demo`,
  DATABASE_URL:`postgres://talon_app:${'b'.repeat(48)}@127.0.0.1:15432/talon_amigo_demo`,
});
test('configuración generada se lee en Windows y conserva secretos sin imprimirlos',()=>{
  const original=config();const text=Object.entries(original).map(([key,value])=>`${key}=${value}`).join('\r\n');
  assert.deepEqual(validateConfig(parseConfig(text)),original);
});
test('rechaza configuraciones ajenas, bases remotas y rol superusuario para la app',()=>{
  assert.throws(()=>validateConfig({...config(),TALON_WINDOWS_DEMO:undefined}));
  assert.throws(()=>validateConfig({...config(),DATABASE_URL_ADMIN:'postgres://admin:clave@real.example/produccion'}));
  assert.throws(()=>validateConfig({...config(),DATABASE_URL:config().DATABASE_URL_ADMIN}));
});
test('rechaza puertos, proyectos y claves manipulados antes de ejecutar comandos',()=>{
  for(const invalid of [{TALON_WINDOWS_HTTP_PORT:'14317 & echo algo'},{TALON_WINDOWS_DB_PORT:'99999'},{TALON_WINDOWS_PROJECT:'otro-proyecto'},{TALON_WINDOWS_APP_PASSWORD:"x'"}]) assert.throws(()=>validateConfig({...config(),...invalid}));
});
test('las variables heredadas no desvían las migraciones ni habilitan ARCA real',()=>{
  const previous=process.env.DATABASE_URL_ADMIN;process.env.DATABASE_URL_ADMIN='postgres://real.example/real';
  try {const env=childEnv({...config(),ARCA_MODE:'live'});assert.equal(env.DATABASE_URL_ADMIN,config().DATABASE_URL_ADMIN);assert.equal(env.ARCA_MODE,'mock');assert.equal(env.NODE_ENV,'production');}
  finally {if(previous===undefined)delete process.env.DATABASE_URL_ADMIN;else process.env.DATABASE_URL_ADMIN=previous;}
});
test('proyecto Docker independiente y sin órdenes de borrado de volúmenes',()=>{
  const args=composeArgs(config());assert.equal(args[args.indexOf('-p')+1],config().TALON_WINDOWS_PROJECT);assert.ok(args.includes('--env-file'));assert.ok(!args.includes('down'));assert.ok(!args.includes('-v'));
});
test('elige otro puerto cuando el preferido ya está ocupado',async()=>{
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  try {assert.notEqual(await freePort(port),port);} finally {await new Promise(resolve=>server.close(resolve));}
});

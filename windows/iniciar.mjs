import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { root, prerequisites, loadConfig, childEnv, composeArgs, run } from './comun.mjs';
function openBrowser(url) {
  console.log('Abrí '+url+'/ingreso en Chrome.');
  if(process.platform==='win32') {
    const browser=spawn('cmd.exe',['/d','/s','/c',`start "" "${url}/ingreso"`],{stdio:'ignore',windowsVerbatimArguments:true});
    browser.on('error',()=>console.log('No se pudo abrir el navegador automáticamente. Usá la dirección indicada.'));
  }
}
async function main() {
  process.chdir(root);
  const config = loadConfig();
  if (!existsSync(join(root,'.talon-windows.json')) || !existsSync(join(root,'.next/BUILD_ID'))) throw Error('Primero completá INSTALAR-TALON.cmd.');
  prerequisites();
  const env = childEnv(config);
  await run('docker', [...composeArgs(config),'up','-d','--wait','--wait-timeout','120'], env);
  const url = `http://127.0.0.1:${config.TALON_WINDOWS_HTTP_PORT}`;
  try { const response = await fetch(url+'/api/salud', { signal: AbortSignal.timeout(1000) }); if(response.ok) { openBrowser(url); return; } }
  catch {}
  console.log(`Talón Demo: ${url}\nDejá esta ventana abierta mientras trabajás. Para detener Talón, usá Ctrl+C.\nPostgreSQL conserva los datos al cerrar. Respaldos en la carpeta backups.`);
  const server = spawn(process.execPath, ['scripts/serve.mjs','start','--hostname','127.0.0.1','--port',config.TALON_WINDOWS_HTTP_PORT], { cwd:root, env, stdio:'inherit' });
  let running = true, stopping = false;
  const stop = () => {
    if(!running) return;
    stopping=true; running=false;
    if(process.platform==='win32') {
      const killer=spawn('taskkill.exe',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore'});
      killer.on('error',()=>server.kill());
    } else server.kill();
  };
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  server.on('error', () => { running=false;console.error('No se pudo iniciar Talón.');process.exitCode=1; });
  server.on('exit',code => { running=false;process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);process.exitCode=stopping ? 0 : (code ?? 1); });
  for(let i=0;running && i<60;i++) {
    try {
      const response = await fetch(url+'/api/salud',{signal:AbortSignal.timeout(1000)});
      if(response.ok) {
        openBrowser(url);
        break;
      }
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

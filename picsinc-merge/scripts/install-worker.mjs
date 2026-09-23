// Install the existing Mac worker for this user's login session.
import {mkdir,writeFile,readFile,cp,chmod} from 'node:fs/promises';
import {constants} from 'node:fs';
import {parseEnv} from 'node:util';
import {homedir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const source=process.cwd();
const cwd=path.join(homedir(),'Library','Application Support','PicSinc','worker');
const yolo=path.join(cwd,'yolo');
const label='com.picsinc.photo-worker';
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const folder=path.join(homedir(),'Library','LaunchAgents');
const logs=path.join(homedir(),'Library','Logs','PicSinc');
await mkdir(folder,{recursive:true});await mkdir(logs,{recursive:true});
const settings=parseEnv(await readFile(path.join(source,'.env.worker'),'utf8'));
if(!settings.WORKER_BASE_URL || !settings.WORKER_TOKEN || settings.WORKER_TOKEN.length<32) throw new Error('Configure .env.worker first');
const domain=`gui/${process.getuid()}`;
spawnSync('launchctl',['bootout',`${domain}/${label}`],{stdio:'ignore'});
// LaunchAgents must not depend on Desktop-folder access. Copy only program files,
// dependencies and the existing model; no photos or Supabase credentials.
const copyOptions={recursive:true,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE};
await mkdir(cwd,{recursive:true});await mkdir(yolo,{recursive:true});
for(const entry of ['src','node_modules','package.json','tsconfig.json']) await cp(path.join(source,entry),path.join(cwd,entry),copyOptions);
const modelSource=path.resolve(source,'../experiments/yolo-outline');
for(const entry of ['.venv','export_regions.py','outline.py','overlap.py','.cache/yolo26n-seg.pt']) await cp(path.join(modelSource,entry),path.join(yolo,entry),copyOptions);
await writeFile(path.join(cwd,'.env.worker'),Object.entries({WORKER_BASE_URL:settings.WORKER_BASE_URL,WORKER_TOKEN:settings.WORKER_TOKEN,YOLO_RUNTIME_DIR:yolo,YOLO_PYTHON:path.join(yolo,'.venv/bin/python')}).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600});
await chmod(path.join(cwd,'.env.worker'),0o600);
const file=path.join(folder,`${label}.plist`);
const args=[process.execPath,'--env-file=.env.worker','--import','tsx','src/features/composition/worker-main.ts'];
await writeFile(file,`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(a=>`<string>${xml(a)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(cwd)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path.dirname(process.execPath))}:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(path.join(logs,'worker.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logs,'worker-error.log'))}</string>
</dict></plist>`,{mode:0o600});
const result=spawnSync('launchctl',['bootstrap',domain,file],{stdio:'inherit'});
if(result.status!==0) process.exit(result.status||1);
console.log(`Installed ${label}. Check: launchctl print ${domain}/${label}`);

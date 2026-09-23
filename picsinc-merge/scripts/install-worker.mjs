// Install the existing Mac worker for this user's login session.
import {mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const cwd=process.cwd();
const label='com.picsinc.photo-worker';
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const folder=path.join(homedir(),'Library','LaunchAgents');
const logs=path.join(homedir(),'Library','Logs','PicSinc');
await mkdir(folder,{recursive:true});await mkdir(logs,{recursive:true});
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
const domain=`gui/${process.getuid()}`;
spawnSync('launchctl',['bootout',`${domain}/${label}`],{stdio:'ignore'});
const result=spawnSync('launchctl',['bootstrap',domain,file],{stdio:'inherit'});
if(result.status!==0) process.exit(result.status||1);
console.log(`Installed ${label}. Check: launchctl print ${domain}/${label}`);

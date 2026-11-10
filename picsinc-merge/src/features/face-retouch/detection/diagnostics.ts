const stages = ['worker-create', 'worker-error', 'worker-timeout', 'runtime-import', 'wasm-setup', 'model-init', 'full-detect', 'roi-crop', 'roi-detect', 'roi-map'] as const;
const reasons = ['network', 'memory', 'webgl', 'wasm', 'unsupported', 'timeout', 'unknown'] as const;
const errorNames = ['Error', 'TypeError', 'RangeError', 'RuntimeError', 'NetworkError', 'SecurityError', 'NotSupportedError', 'InvalidStateError', 'DataCloneError', 'AbortError', 'UnknownError'] as const;
const browsers = ['chrome', 'chrome-ios', 'edge', 'firefox', 'safari', 'unknown'] as const;
const platforms = ['ios', 'android', 'macos', 'windows', 'linux', 'unknown'] as const;
export const detectionLogKey = 'moira:face-detection-failures';
export type DetectionDiagnostic = {
  stage: typeof stages[number]; reason: typeof reasons[number]; errorName: typeof errorNames[number];
  width: number; height: number; regionCount: number; regionIndex: number;
  cropWidth: number; cropHeight: number; elapsedMs: number;
};
type FailureLog = {
  schemaVersion: 1; recordedAt: number; browser: typeof browsers[number]; browserMajor: number;
  platform: typeof platforms[number]; diagnostic: DetectionDiagnostic;
};
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const member = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && list.includes(value as T);

// Allowlisted fields only: never retain messages, stacks, URLs, masks or landmarks.
export function parseDiagnostic(value: unknown): DetectionDiagnostic | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as Record<string, unknown>;
  if (!member(stages,d.stage) || !member(reasons,d.reason) || !member(errorNames,d.errorName)
    || !integer(d.width,0,8192) || !integer(d.height,0,8192) || !integer(d.regionCount,0,10000)
    || !integer(d.regionIndex,-1,10000) || !integer(d.cropWidth,0,8192) || !integer(d.cropHeight,0,8192)
    || !integer(d.elapsedMs,0,86400000)) return null;
  return {stage:d.stage,reason:d.reason,errorName:d.errorName,width:d.width,height:d.height,regionCount:d.regionCount,regionIndex:d.regionIndex,cropWidth:d.cropWidth,cropHeight:d.cropHeight,elapsedMs:d.elapsedMs};
}
export function parseFailureLog(value: unknown): FailureLog | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>, diagnostic = parseDiagnostic(v.diagnostic);
  if (v.schemaVersion !== 1 || !integer(v.recordedAt,0,8640000000000000) || !member(browsers,v.browser)
    || !member(platforms,v.platform) || !integer(v.browserMajor,0,9999) || !diagnostic) return null;
  return {schemaVersion:1,recordedAt:v.recordedAt,browser:v.browser,browserMajor:v.browserMajor,platform:v.platform,diagnostic};
}
export function classifyDetectionError(error: unknown): Pick<DetectionDiagnostic,'reason'|'errorName'> {
  const e = error as {name?: unknown;message?: unknown} | null;
  const message = typeof e?.message === 'string' ? e.message.toLowerCase() : '';
  const reason = /memory|allocation|out of bounds|out of memory/.test(message) ? 'memory'
    : /webgl|context lost|texture|gpu/.test(message) ? 'webgl'
    : /fetch|network|load failed|failed to load|importscripts/.test(message) ? 'network'
    : /wasm|webassembly/.test(message) ? 'wasm'
    : /not supported|unsupported|not defined/.test(message) ? 'unsupported' : 'unknown';
  return {reason,errorName:member(errorNames,e?.name)?e.name:'UnknownError'};
}
function environment(): Pick<FailureLog,'browser'|'browserMajor'|'platform'> {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const matches: Array<[FailureLog['browser'], RegExp]> = [['chrome-ios',/CriOS\/(\d+)/],['edge',/Edg(?:e|A|iOS)?\/(\d+)/],['firefox',/(?:Firefox|FxiOS)\/(\d+)/],['chrome',/Chrome\/(\d+)/],['safari',/Version\/(\d+).*Safari/]];
  const match = matches.map(([browser,pattern])=>({browser,version:pattern.exec(ua)?.[1]})).find(m=>m.version);
  const ios = /iPhone|iPad|iPod/.test(ua) || /Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
  const platform = ios?'ios':/Android/.test(ua)?'android':/Macintosh|Mac OS X/.test(ua)?'macos':/Windows/.test(ua)?'windows':/Linux/.test(ua)?'linux':'unknown';
  return {browser:match?.browser??'unknown',browserMajor:Number(match?.version??0),platform};
}
export function recordDetectionFailure(diagnostic: DetectionDiagnostic): void {
  try {
    const log = parseFailureLog({schemaVersion:1,recordedAt:Date.now(),...environment(),diagnostic});
    if (!log) return;
    try { console.error('[retouch-detection-failed]',log); } catch { /* Logging never changes editing. */ }
    try {
      let saved: unknown = [];
      try { saved = JSON.parse(localStorage.getItem(detectionLogKey)??'[]'); } catch { /* Replace unreadable history if storage is writable. */ }
      const previous = Array.isArray(saved)?saved.map(parseFailureLog).filter(Boolean):[];
      localStorage.setItem(detectionLogKey,JSON.stringify([...previous.slice(-9),log]));
    } catch { /* Private browsing or full storage must not prevent delivery. */ }
    try {
      void fetch('/api/retouch/diagnostics',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',referrerPolicy:'no-referrer',body:JSON.stringify(log),keepalive:true}).catch(()=>undefined);
    } catch { /* The local copy remains available when delivery fails. */ }
  } catch { /* Diagnostic collection must not replace the original failure. */ }
}

import { parseFailureLog } from '@/features/face-retouch/detection/diagnostics';

export async function POST(request: Request) {
  const target = new URL(request.url);
  // Next may reconstruct request.url with its listening hostname. Use the HTTP host.
  if (request.headers.get('host')) target.host = request.headers.get('host')!;
  if (request.headers.get('origin') !== target.origin) return new Response(null,{status:403});
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return new Response(null,{status:415});
  if (Number(request.headers.get('content-length')??0) > 2048) return new Response(null,{status:413});
  try {
    const raw = await request.text();
    if (raw.length > 2048) return new Response(null,{status:413});
    const log = parseFailureLog(JSON.parse(raw));
    if (!log) return new Response(null,{status:400});
    // Browser-supplied diagnostics, not authoritative server events. No DB writes.
    console.error('[retouch-detection-failed]',JSON.stringify(log));
    return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
  } catch { return new Response(null,{status:400}); }
}

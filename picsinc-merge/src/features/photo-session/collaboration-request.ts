import { SessionError } from './errors';
// 4 MiB edit records plus small command metadata, below the hosting body limit.
export const MAX_COLLABORATION_BODY_BYTES = 4 * 1024 * 1024 + 64 * 1024;
export async function readCollaborationRequest(request: Request): Promise<unknown> {
  const tooLarge=()=>new SessionError(413,'보정 기록이 너무 큽니다.');
  const declared=Number(request.headers.get('content-length'));
  if (declared>MAX_COLLABORATION_BODY_BYTES) throw tooLarge();
  if (!request.body) throw new SyntaxError('Empty request body');
  const reader=request.body.getReader(); const chunks:Uint8Array[]=[]; let length=0;
  try {
    for (;;) {
      const {done,value}=await reader.read(); if (done) break;
      length+=value.byteLength;
      if (length>MAX_COLLABORATION_BODY_BYTES) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks,length).toString('utf8'));
}

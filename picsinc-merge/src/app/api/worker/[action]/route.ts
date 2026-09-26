import { apiError } from "@/app/api/sessions/session-api";
import { authenticateWorker,claimWorker,completeWorker,updateWorker,workerStatus } from "@/features/photo-session/processing-service";
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{action:string}>}) {
  try {
    authenticateWorker(request);
    const {action}=await params;
    if(action==='claim') return Response.json({job:await claimWorker()},{headers:{'Cache-Control':'no-store'}});
    if(action==='status') return Response.json(await workerStatus(),{headers:{'Cache-Control':'no-store'}});
    const bytes=await request.text();
    if(bytes.length>128_000) return Response.json({error:'Request too large'},{status:413});
    const body=JSON.parse(bytes);
    if(typeof body.id!=='string' || typeof body.leaseToken!=='string' || !/^[0-9a-f-]{36}$/i.test(body.id) || !/^[0-9a-f-]{36}$/i.test(body.leaseToken)) return Response.json({error:'Invalid job'},{status:400});
    if(action==='complete') return Response.json(await completeWorker(body));
    if(action==='heartbeat'||action==='fail') return Response.json(await updateWorker(action,body));
    return Response.json({error:'Not found'},{status:404});
  } catch(error) {return apiError(error);}
}

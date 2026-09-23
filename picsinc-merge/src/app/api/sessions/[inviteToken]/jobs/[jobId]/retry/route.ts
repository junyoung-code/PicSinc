import { apiError,credentials } from "../../../../session-api";
import { jobState,enqueue } from "@/features/photo-session/processing-service";
export async function POST(_:Request,{params}:{params:Promise<{inviteToken:string;jobId:string}>}) {
  try {const {inviteToken,jobId}=await params;const auth={inviteToken,...await credentials(inviteToken)};const {row}=await jobState(auth,jobId);const job=await enqueue(auth,row.kind,{assetId:row.input.assetId,version:row.input.version,retry:true});return Response.json({job},{status:job.status==='ready'?200:202,headers:{'Cache-Control':'no-store'}});}
  catch(error){return apiError(error);}
}

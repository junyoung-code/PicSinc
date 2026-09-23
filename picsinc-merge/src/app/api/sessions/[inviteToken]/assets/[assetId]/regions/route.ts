import { apiError,credentials } from "../../../../session-api";
import { enqueue } from "@/features/photo-session/processing-service";
export async function POST(_:Request,{params}:{params:Promise<{inviteToken:string;assetId:string}>}) {
 try {const {inviteToken,assetId}=await params;const job=await enqueue({inviteToken,...await credentials(inviteToken)},'detect',{assetId,retry:true});return Response.json({job},{status:job.status==='ready'?200:202,headers:{'Cache-Control':'no-store'}});}
 catch(error){return apiError(error);}
}

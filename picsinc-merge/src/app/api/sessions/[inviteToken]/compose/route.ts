import { apiError,credentials,service } from "../../session-api";
import { enqueue } from "@/features/photo-session/processing-service";
export async function POST(request:Request,{params}:{params:Promise<{inviteToken:string}>}) {
 try {
  const {inviteToken}=await params;const auth={inviteToken,...await credentials(inviteToken)};const {expectedVersion}=await request.json();
  const snapshot=await service().snapshot(inviteToken,auth.participantId,auth.sessionToken);
  if(snapshot.session.ownerParticipantId!==auth.participantId) return Response.json({error:'대표자만 병합할 수 있습니다.'},{status:403});
  if(snapshot.session.version!==expectedVersion) return Response.json({error:'사진이나 선택이 바뀌었어요. 다시 불러와 주세요.'},{status:409});
  if(snapshot.result?.version===expectedVersion) return Response.json({result:snapshot.result},{headers:{'Cache-Control':'no-store'}});
  const job=await enqueue(auth,'compose',{version:expectedVersion,retry:true});
  return Response.json({job},{status:job.status==='ready'?200:202,headers:{'Cache-Control':'no-store'}});
 } catch(error){return apiError(error);}
}

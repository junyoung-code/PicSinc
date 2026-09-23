import { apiError,credentials } from "../../../session-api";
import { jobState } from "@/features/photo-session/processing-service";
export async function GET(_:Request,{params}:{params:Promise<{inviteToken:string;jobId:string}>}) {
  try {const {inviteToken,jobId}=await params;const {job}=await jobState({inviteToken,...await credentials(inviteToken)},jobId);return Response.json({job},{headers:{'Cache-Control':'no-store'}});}
  catch(error){return apiError(error);}
}

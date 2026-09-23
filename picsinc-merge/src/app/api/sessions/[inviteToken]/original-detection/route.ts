import { apiError,credentials } from "../../session-api";
import { originalState } from "@/features/photo-session/processing-service";
type Context={params:Promise<{inviteToken:string}>};
async function respond(context:Context,retry:boolean) {
 try {const {inviteToken}=await context.params;const state=await originalState({inviteToken,...await credentials(inviteToken)},retry);return Response.json(state,{headers:{'Cache-Control':'no-store'}});}
 catch(error){return apiError(error);}
}
export function GET(_:Request,context:Context){return respond(context,false);}
export function POST(_:Request,context:Context){return respond(context,true);}

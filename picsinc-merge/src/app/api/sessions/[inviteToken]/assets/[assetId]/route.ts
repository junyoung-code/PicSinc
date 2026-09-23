import { apiError,credentials } from "../../../session-api";
import { authorizeProcessing,signedRead } from "@/features/photo-session/processing-service";
import { SupabasePhotoSessionStore } from "@/integrations/storage/supabase-photo-session-store";
export async function GET(_:Request,{params}:{params:Promise<{inviteToken:string;assetId:string}>}) {
 try {const {inviteToken,assetId}=await params;const session=await authorizeProcessing({inviteToken,...await credentials(inviteToken)});const asset=await new SupabasePhotoSessionStore().findAsset(session.id,assetId);
  if(!asset)return Response.json({error:'파일을 찾을 수 없습니다.'},{status:404});
  const extension=asset.contentType==='image/jpeg'?'jpg':'png';const url=await signedRead(asset.storageKey,session.expiresAt,asset.kind==='preview'?undefined:`${asset.kind}.${extension}`);
  return new Response(null,{status:302,headers:{Location:url,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
 }catch(error){return apiError(error);}
}

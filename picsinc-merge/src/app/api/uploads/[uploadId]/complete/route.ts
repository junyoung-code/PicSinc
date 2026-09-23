import { complete } from "@/features/photo-session/direct-uploads";
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{uploadId:string}>}) {return complete(request,(await params).uploadId);}

import { prepareSession } from "@/features/photo-session/direct-uploads";

export async function POST(request: Request, { params }: { params: Promise<{ inviteToken: string; kind: string }> }) {
  const { inviteToken, kind } = await params;
  return prepareSession(request, inviteToken, kind);
}

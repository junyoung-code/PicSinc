import SessionFlow from "@/features/mobile-flow/SessionFlow";
export default async function SessionPage({ params }: { params: Promise<{ inviteToken: string }> }) {
  const { inviteToken } = await params;
  return <SessionFlow inviteToken={inviteToken} />;
}

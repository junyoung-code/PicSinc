import SessionEntry from "@/features/mobile-flow/SessionEntry";

// Keep existing experimental rooms accessible without replacing the merge flow.
export default async function CollaborationPage({ params }: { params: Promise<{ inviteToken: string }> }) {
  const { inviteToken } = await params;
  return <SessionEntry inviteToken={inviteToken} />;
}

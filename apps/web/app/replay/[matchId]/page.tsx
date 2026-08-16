import { ReplayViewer } from "./ReplayViewer";

/* The viewer is a client component: it scrubs, which is interaction. The page
   is a thin shell so the route stays a server component and the log is fetched
   by the browser from /api/replay/<id> — the same bytes the tests read. */
export const dynamic = "force-dynamic";

export default async function ReplayPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  return <ReplayViewer matchId={matchId} />;
}

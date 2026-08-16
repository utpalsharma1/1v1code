import { LivePanel } from "./LivePanel";
import { CodeEntry } from "./CodeEntry";

/* /watch — what is on, and a box for a code.

   The panel goes FIRST because it answers the question most visitors have
   ("is anything happening?") without them typing anything; the code entry is
   for someone who already has one. */
export const dynamic = "force-dynamic";

export default function WatchPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <LivePanel />
      <CodeEntry />
    </div>
  );
}

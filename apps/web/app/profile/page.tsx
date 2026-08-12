import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

/* `/profile` is the rail's shortcut to your OWN profile. The canonical,
   shareable URL is `/u/<handle>` — one page, one address, so a link somebody
   sends is the same page they were looking at. */
export const dynamic = "force-dynamic";

export default async function MyProfile() {
  const me = await currentUser();
  if (!me) redirect("/login");
  redirect(`/u/${encodeURIComponent(me.handle)}`);
}

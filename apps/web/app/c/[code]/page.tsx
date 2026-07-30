"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, cn } from "@1v1/ui";
import { formatCode } from "@1v1/core/codes";

/* ============================================================================
   /c/<code> — the invited side of a challenge link (§7, Phase 2D).

   THE LAUNCH FEATURE, and it is written for the person who has never heard of
   us. They were sent a URL by a friend; everything here is optimised for that
   one moment.

   NO REGISTRATION WALL. §7 is explicit that requiring an account before a first
   match probably costs more than every other growth feature combined. Taking the
   link creates a guest — a credential-less account with an ordinary session — and
   the match runs identically to a matched one.

   A STALE LINK IS NOT A 404. It says who challenged whom, that it expired, and
   offers one click to send one back. A dead end here is a lost player, and a
   link opened tomorrow rather than tonight is the most likely way this feature
   gets used slightly wrong.
   ========================================================================= */

interface Info {
  state: "open" | "expired" | "taken" | "unknown";
  code: string;
  host: string;
  hostRating: number;
  mode: string;
  band: [number, number];
  allowGuest: boolean;
  youAreHost: boolean;
  signedIn: boolean;
}

export default function ChallengePage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = (params?.code ?? "").toString();
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/challenge/${code}`);
    if (!response.ok && response.status !== 404) {
      setError("Could not reach the server.");
      return;
    }
    setInfo((await response.json()) as Info);
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/challenge/${code}`, { method: "POST" });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(body.error ?? "Could not join.");
      setBusy(false);
      void load();
      return;
    }
    /* Hand off to /play, which owns the socket, the accept flow and the whole
       match screen. The challenge is a way IN — it is not a second match UI. */
    router.push(`/play?challenge=${code}`);
  };

  if (!info) {
    return (
      <Shell code={code}>
        <p className="text-fg-faint text-13">Loading…</p>
      </Shell>
    );
  }

  if (info.state === "unknown") {
    return (
      <Shell code={code}>
        <Card title="That link doesn't work" tone="elevated">
          <p className="text-fg-dim text-13 leading-relaxed">
            This challenge code doesn&apos;t match anything. Check it was copied whole — codes are ten
            characters.
          </p>
          <div className="mt-5">
            <a href="/">
              <Button variant="outline">Back to 1v1.code</Button>
            </a>
          </div>
        </Card>
      </Shell>
    );
  }

  if (info.state === "expired" || info.state === "taken") {
    const taken = info.state === "taken";
    return (
      <Shell code={code}>
        <Card title={taken ? "Already taken" : "This challenge expired"} tone="elevated">
          <p className="text-fg-dim text-13 leading-relaxed">
            <span className="text-fg">{info.host}</span>{" "}
            {taken
              ? "sent this to someone, and someone already took it."
              : "challenged you, but the link has passed its 24 hours."}
          </p>
          {/* §7: never a dead end. Send one back, aimed at the original host. */}
          <p className="text-fg-faint mt-3 text-12 leading-relaxed">
            You can send one back — {info.host} will get a fresh link from you.
          </p>
          <div className="mt-5 flex gap-2">
            <a href={`/play?rechallenge=${encodeURIComponent(info.host)}`}>
              <Button variant="solid" tone="player">
                Send one back
              </Button>
            </a>
            <a href="/">
              <Button variant="outline">Back to 1v1.code</Button>
            </a>
          </div>
        </Card>
      </Shell>
    );
  }

  if (info.youAreHost) {
    return (
      <Shell code={code}>
        <Card title="This is your link" tone="elevated">
          <p className="text-fg-dim text-13 leading-relaxed">
            Send it to someone else — you can&apos;t play yourself. It works for 24 hours and the first
            person to open it joins.
          </p>
          <div className="mt-5 flex gap-2">
            <a href="/play">
              <Button variant="outline">Back to Play</Button>
            </a>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell code={code}>
      <Card title={`${info.host} challenged you`}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span data-side="p2" className="font-display text-player text-20 font-extrabold uppercase">
            {info.host}
          </span>
          <span className="tabular text-fg-faint text-12">rated {info.hostRating}</span>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-12">
          <Fact label="Mode">{info.mode === "RANKED" ? "Ranked" : "Casual"}</Fact>
          <Fact label="Difficulty">
            {info.band[0]}–{info.band[1]}
          </Fact>
        </dl>

        {!info.signedIn && (
          <p className="text-fg-dim mt-5 text-13 leading-relaxed">
            You don&apos;t need an account. Accepting creates a guest so you can play right now — the
            match won&apos;t affect anyone&apos;s rating, and you can keep the result afterwards if you
            want to.
          </p>
        )}

        {error && (
          <p className="text-fail mt-4 text-13" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-2">
          <Button variant="solid" tone="player" size="lg" onClick={() => void accept()} disabled={busy}>
            {busy ? "Joining…" : info.signedIn ? "Accept challenge" : "Play as guest"}
          </Button>
          {!info.signedIn && (
            <a href="/login">
              <Button variant="outline">Sign in first</Button>
            </a>
          )}
        </div>
      </Card>
    </Shell>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-line clip-lean-sm border px-3 py-2">
      <dt className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
        {label}
      </dt>
      <dd className="tabular text-fg mt-0.5 text-13">{children}</dd>
    </div>
  );
}

function Shell({ code, children }: { code: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <div>
        <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
          challenge
        </p>
        <h1 className="font-display text-fg mt-2 text-34 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
          1v1<span className="text-player">.</span>code
        </h1>
      </div>
      {children}
      <p className={cn("tabular text-fg-faint text-12")}>{formatCode(code.toUpperCase())}</p>
    </main>
  );
}

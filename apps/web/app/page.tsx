import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <div>
        <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
          Phase 0 · Foundation
        </p>
        <h1 className="font-display text-fg mt-3 text-48 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
          1v1<span className="text-player">.</span>code
        </h1>
        <p className="text-fg-dim mt-4 max-w-lg text-16 leading-relaxed">
          A fighting-game HUD rendered in the language of a code editor. Nothing is playable yet —
          this build ships the token system, the motion system, and the seven primitives everything
          else will be assembled from.
        </p>
      </div>

      <nav className="flex flex-col gap-px">
        <Link
          href="/dev/kitchen-sink"
          className="clip-p1 border-line group flex items-center justify-between border bg-surface px-5 py-4 transition-colors duration-[160ms] hover:border-[var(--player)]"
        >
          <span>
            <span className="font-display text-fg block text-16 font-bold tracking-[var(--track-display)] uppercase">
              Kitchen sink
            </span>
            <span className="text-fg-faint text-13">Every primitive, every state</span>
          </span>
          <span className="text-player font-display text-20">→</span>
        </Link>
      </nav>
    </main>
  );
}

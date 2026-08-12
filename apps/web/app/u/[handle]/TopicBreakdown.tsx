/* ============================================================================
   Per-topic strength — and the decision NOT to draw a radar until it means
   something.

   A RADAR FROM SPARSE DATA IS WORSE THAN NO RADAR, and the reason is specific
   rather than aesthetic. With one or two matches in a topic the only possible
   win rates are 0%, 50% and 100%, so the shape is noise; and any sensible
   smoothing pulls an unmeasured topic toward the middle, which draws a
   near-regular pentagon. A regular pentagon does not read as "we have no idea",
   it reads as "evenly skilled across all five" — a confident claim, made from
   nothing, on the screen a shared link most often lands on.

   So:

     0 matches      no radar, no breakdown. A line saying what will appear and
                    what it takes, because an empty chart frame is a broken
                    thing and a sentence is an invitation.
     below MIN      the per-topic BREAKDOWN: matches played and won per topic.
                    Counts are facts; a skill estimate from them is not. It
                    doubles as progress toward the radar.
     MIN and above  the radar, over the topics that qualify.

   THE NUMBERS. A spoke needs MIN_PER_TOPIC = 5 decided matches, and the radar
   needs MIN_TOPICS = 3 spokes. Five is where a win rate stops being three
   possible values and starts having a middle; three spokes is the fewest that
   makes a shape rather than a line. In practice that is ~15 matches minimum and
   more like 25 before the radar is full, which is the honest cost of a chart
   that claims to describe somebody.

   Drawn as inline SVG. §3 permits no charting dependency and a pentagon does
   not need one.
   ========================================================================= */

const TOPICS = ["DP", "GRAPHS", "GREEDY", "STRINGS", "MATH"] as const;
type Topic = (typeof TOPICS)[number];

/** Decided matches in a topic before that spoke may be drawn. */
export const MIN_PER_TOPIC = 5;
/** Qualifying spokes before the radar is drawn at all. */
export const MIN_TOPICS = 3;

export interface TopicRow {
  topic: string;
  won: boolean;
  decided: boolean;
}

export function TopicBreakdown({ matches }: { matches: TopicRow[] }) {
  const stats = TOPICS.map((topic) => {
    const rows = matches.filter((m) => m.topic === topic && m.decided);
    const won = rows.filter((m) => m.won).length;
    return { topic, played: rows.length, won, rate: rows.length ? won / rows.length : 0 };
  });
  const qualifying = stats.filter((s) => s.played >= MIN_PER_TOPIC);
  const anyPlayed = stats.some((s) => s.played > 0);

  if (!anyPlayed) {
    return (
      <section>
        <h2 className="font-display text-fg-faint mb-2.5 text-12 font-bold tracking-[var(--track-hud)] uppercase">
          By topic
        </h2>
        <div className="border-line clip-corner border border-dashed bg-surface/40 px-5 py-6">
          <p className="text-fg-dim text-13">
            Nothing to show yet. Play {MIN_PER_TOPIC} matches in a topic and it appears here —{" "}
            {MIN_TOPICS} topics and this becomes a chart of where you are strong.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="font-display text-fg-faint mb-2.5 text-12 font-bold tracking-[var(--track-hud)] uppercase">
        By topic
      </h2>
      {qualifying.length >= MIN_TOPICS ? (
        <div className="border-line clip-corner flex items-center gap-6 border bg-surface px-5 py-5">
          <Radar stats={stats} />
          <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
            {stats.map((s) => (
              <li key={s.topic} className="flex items-baseline gap-2 text-12">
                <span className="font-display text-fg-dim w-16 shrink-0 font-bold tracking-[var(--track-hud)]">
                  {s.topic}
                </span>
                {s.played >= MIN_PER_TOPIC ? (
                  <span className="text-fg tabular">{Math.round(s.rate * 100)}%</span>
                ) : (
                  <span className="text-fg-faint">
                    {s.played}/{MIN_PER_TOPIC}
                  </span>
                )}
                <span className="text-fg-faint tabular ml-auto">{s.played}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        /* Counts, not a skill claim. */
        <div className="border-line clip-corner border bg-surface px-5 py-4">
          <ul className="flex flex-col gap-2">
            {stats.map((s) => (
              <li key={s.topic} className="flex items-center gap-3">
                <span className="font-display text-fg-dim w-16 shrink-0 text-12 font-bold tracking-[var(--track-hud)]">
                  {s.topic}
                </span>
                <span className="bg-elevated h-1.5 flex-1 overflow-hidden rounded-[2px]">
                  <span
                    className="bg-p1 block h-full origin-left"
                    style={{ width: `${Math.min(100, (s.played / MIN_PER_TOPIC) * 100)}%` }}
                  />
                </span>
                <span className="text-fg-faint tabular w-14 shrink-0 text-right text-12">
                  {s.played === 0 ? "—" : `${s.won}/${s.played}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-fg-faint mt-3 text-12">
            {qualifying.length} of {MIN_TOPICS} topics ready. Win rates appear per topic at{" "}
            {MIN_PER_TOPIC} decided matches — before that the number would be noise.
          </p>
        </div>
      )}
    </section>
  );
}

function Radar({ stats }: { stats: { topic: Topic; played: number; rate: number }[] }) {
  const size = 132;
  const c = size / 2;
  const r = c - 16;
  const point = (i: number, v: number) => {
    const a = (Math.PI * 2 * i) / TOPICS.length - Math.PI / 2;
    return [c + Math.cos(a) * r * v, c + Math.sin(a) * r * v] as const;
  };
  /* An unqualified spoke is pulled to the centre rather than to the middle:
     absent data must not look like average performance. */
  const shape = stats
    .map((s, i) => point(i, s.played >= MIN_PER_TOPIC ? Math.max(0.08, s.rate) : 0))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const grid = [0.25, 0.5, 0.75, 1]
    .map((f) =>
      TOPICS.map((_, i) => point(i, f))
        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
        .join(" "),
    );

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label="Win rate by topic">
      {grid.map((g, i) => (
        <polygon key={i} points={g} fill="none" stroke="var(--line)" strokeWidth="1" />
      ))}
      <polygon points={shape} fill="var(--p1-glow)" stroke="var(--p1)" strokeWidth="1.5" />
    </svg>
  );
}

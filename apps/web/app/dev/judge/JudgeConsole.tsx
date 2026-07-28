"use client";

import { useCallback, useRef, useState } from "react";
import { Button, Card, TestBar, cn, type CellState } from "@1v1/ui";

interface ProblemSummary {
  slug: string;
  title: string;
  rating: number;
  topic: string;
  statement: string;
  constraints: string;
  tests: number;
}

type Line = { id: number; text: string; tone: "info" | "pass" | "fail" | "dim" };

const STARTERS: Record<string, string> = {
  PYTHON3: "import sys\n\ndef main():\n    data = sys.stdin.read().split()\n    # ...\n    print()\n\nmain()\n",
  CPP17:
    '#include <bits/stdc++.h>\nusing namespace std;\n\nint main(){\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // ...\n    return 0;\n}\n',
};

export function JudgeConsole({
  problems,
  dbError,
}: {
  problems: ProblemSummary[];
  dbError: string | null;
}) {
  const [slug, setSlug] = useState(problems[0]?.slug ?? "");
  const [language, setLanguage] = useState<"PYTHON3" | "CPP17">("PYTHON3");
  const [source, setSource] = useState(STARTERS["PYTHON3"]!);
  const [cells, setCells] = useState<CellState[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const lineId = useRef(0);

  const problem = problems.find((p) => p.slug === slug);

  const log = useCallback((text: string, tone: Line["tone"] = "dim") => {
    setLines((prev) => [...prev, { id: ++lineId.current, text, tone }]);
  }, []);

  const run = useCallback(async () => {
    if (!problem || running) return;
    setRunning(true);
    setLines([]);
    setCells(Array<CellState>(problem.tests).fill("idle"));
    log(`submitting ${problem.slug} · ${language}`, "info");

    try {
      const response = await fetch("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problemSlug: problem.slug, language, source }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        log(`request failed (${response.status}) ${detail.slice(0, 200)}`, "fail");
        setRunning(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let split = buffer.indexOf("\n\n");
        while (split !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          split = buffer.indexOf("\n\n");

          const payload = frame.replace(/^data: /, "").trim();
          if (!payload) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(payload) as Record<string, unknown>;
          } catch {
            continue;
          }

          switch (event["kind"]) {
            case "queued":
              log("queued", "dim");
              break;
            case "compiling":
              log("compiling", "info");
              break;
            case "compile-failed":
              log("compile error", "fail");
              log(String(event["message"] ?? "").slice(0, 2000), "dim");
              break;
            case "running":
              log(`running ${event["total"]} tests`, "info");
              break;
            case "test": {
              const ordinal = Number(event["ordinal"]);
              const verdict = String(event["verdict"]);
              const ok = verdict === "ACCEPTED";
              setCells((prev) => {
                const next = [...prev];
                next[ordinal] = ok ? "pass" : "fail";
                return next;
              });
              log(
                `test ${ordinal + 1}  ${verdict}  ${event["runtimeMs"]}ms`,
                ok ? "pass" : "fail",
              );
              break;
            }
            case "done":
              log(
                `${event["verdict"]} — ${event["passed"]}/${event["total"]} in ${event["runtimeMs"]}ms`,
                event["verdict"] === "ACCEPTED" ? "pass" : "fail",
              );
              break;
            case "error":
              log(`judge error: ${event["message"]}`, "fail");
              break;
            default:
              break;
          }
        }
      }
    } catch (error) {
      log(`stream failed: ${error instanceof Error ? error.message : String(error)}`, "fail");
    } finally {
      setRunning(false);
    }
  }, [problem, language, source, running, log]);

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-10">
      <header>
        <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
          Phase 2A · judge
        </p>
        <h1 className="font-display text-fg mt-1 text-34 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
          Judge console
        </h1>
        <p className="text-fg-dim mt-2 max-w-2xl text-13 leading-relaxed">
          Paste code, pick a problem, watch verdicts stream in one test at a time. Requires
          Postgres, Redis, the judge worker, and the two judge images.
        </p>
      </header>

      {dbError && (
        <Card title="Database unreachable" tone="elevated">
          <p className="text-fail text-13">{dbError}</p>
          <p className="text-fg-dim mt-2 text-13">
            Run <span className="tabular text-fg">docker compose up -d</span>, then{" "}
            <span className="tabular text-fg">pnpm --filter @1v1/db push</span> and{" "}
            <span className="tabular text-fg">pnpm --filter @1v1/db seed</span>.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-[320px_1fr] gap-6 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4">
          <div>
            <p className="font-display text-fg-faint mb-1.5 text-12 font-bold tracking-[var(--track-hud)] uppercase">
              Problem
            </p>
            <select
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="focus-ring border-line text-fg w-full border bg-surface px-3 py-2 text-13"
            >
              {problems.length === 0 && <option value="">none seeded</option>}
              {problems.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.rating} · {p.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="font-display text-fg-faint mb-1.5 text-12 font-bold tracking-[var(--track-hud)] uppercase">
              Language
            </p>
            <div className="flex gap-1">
              {(["PYTHON3", "CPP17"] as const).map((lang) => (
                <Button
                  key={lang}
                  size="sm"
                  variant={language === lang ? "solid" : "outline"}
                  tone={language === lang ? "player" : "neutral"}
                  onClick={() => {
                    setLanguage(lang);
                    setSource(STARTERS[lang]!);
                  }}
                >
                  {lang === "PYTHON3" ? "Python 3" : "C++17"}
                </Button>
              ))}
            </div>
          </div>

          {problem && (
            <Card title={problem.title} aside={<span className="tabular text-fg-faint text-12">{problem.rating}</span>}>
              <p className="text-fg-dim text-13 leading-relaxed whitespace-pre-line">
                {problem.statement}
              </p>
              <p className="text-fg-faint mt-3 text-12 whitespace-pre-line">{problem.constraints}</p>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            rows={18}
            className="focus-ring tabular border-line text-fg w-full resize-y border bg-surface p-3 text-13 leading-relaxed"
          />

          <div className="flex items-center gap-3">
            <Button variant="solid" tone="player" onClick={run} disabled={running || !problem}>
              {running ? "Running…" : "Submit"}
            </Button>
            {cells.length > 0 && (
              <div data-side="p1" className="min-w-0 flex-1">
                <TestBar side="p1" total={cells.length} cells={cells} />
              </div>
            )}
          </div>

          <div className="border-line h-72 overflow-y-auto border bg-surface p-3">
            {lines.length === 0 ? (
              <p className="text-fg-faint text-12">No output yet.</p>
            ) : (
              lines.map((line) => (
                <p
                  key={line.id}
                  className={cn(
                    "tabular text-12 leading-relaxed",
                    line.tone === "pass" && "text-player",
                    line.tone === "fail" && "text-fail",
                    line.tone === "info" && "text-info",
                    line.tone === "dim" && "text-fg-dim",
                  )}
                >
                  {line.text}
                </p>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

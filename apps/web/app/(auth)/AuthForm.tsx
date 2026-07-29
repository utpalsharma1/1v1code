"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Card } from "@1v1/ui";

/* The form posts to /api/auth/*, not to a server action.

   A server action is only reachable through the RSC protocol, so the sign-in
   path could not be driven by a test — and that is precisely where it broke.
   Posting to a route handler means the end-to-end test exercises the same
   endpoint the browser does, which is the only kind of test that could have
   caught this.

   `method="post"` and `action` are load-bearing, not decoration. Without them a
   browser that has not hydrated falls back to its default — a GET to the current
   URL — which silently reloads the page and writes the password into the URL,
   history and server log. That is exactly what happened. With them, the no-JS
   path is a real POST that works and leaks nothing. */

export function AuthForm({ mode }: { mode: "register" | "login" }) {
  const router = useRouter();
  const params = useSearchParams();
  // Populated by the no-JS redirect path, so a failure without hydration is
  // still visible instead of looking like nothing happened.
  const [error, setError] = useState<string | null>(params.get("error"));
  const [pending, setPending] = useState(false);
  const isRegister = mode === "register";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload = isRegister
      ? {
          handle: String(form.get("handle") ?? ""),
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        }
      : {
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        };

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Same origin, so the Set-Cookie on the response is stored and every
        // later request carries it. No cross-origin cookie question arises.
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? `Request failed (${response.status})`);
        setPending(false);
        return;
      }
      router.push("/play");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Network error");
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div>
        <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
          1v1.code
        </p>
        <h1 className="font-display text-fg mt-2 text-34 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
          {isRegister ? "Create account" : "Sign in"}
        </h1>
      </div>

      <Card>
        <form
          method="post"
          action={`/api/auth/${mode}`}
          onSubmit={onSubmit}
          className="flex flex-col gap-4"
        >
          {isRegister && (
            <Field
              label="Handle"
              name="handle"
              autoComplete="username"
              hint="3–20 characters: letters, digits, underscore"
            />
          )}
          <Field label="Email" name="email" type="email" autoComplete="email" />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            hint={isRegister ? "At least 10 characters" : undefined}
          />

          {error && (
            <p className="text-fail text-13" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" variant="solid" tone="player" full disabled={pending}>
            {pending ? "…" : isRegister ? "Create account" : "Sign in"}
          </Button>
        </form>
      </Card>

      <p className="text-fg-dim text-13">
        {isRegister ? "Already have an account? " : "No account? "}
        <Link
          href={isRegister ? "/login" : "/register"}
          className="text-[var(--player)] underline underline-offset-2"
        >
          {isRegister ? "Sign in" : "Create one"}
        </Link>
      </p>
    </main>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-display text-fg-dim text-12 font-bold tracking-[var(--track-hud)] uppercase">
        {label}
      </span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        className="focus-ring border-line text-fg border bg-elevated px-3 py-2 text-14"
      />
      {hint && <span className="text-fg-faint text-12">{hint}</span>}
    </label>
  );
}

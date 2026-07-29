"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Card } from "@1v1/ui";
import type { FormState } from "./actions";

export function AuthForm({
  mode,
  action,
}: {
  mode: "register" | "login";
  action: (prev: FormState, form: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const isRegister = mode === "register";

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
        <form action={formAction} className="flex flex-col gap-4">
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

          {state.error && (
            <p className="text-fail text-13" role="alert">
              {state.error}
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

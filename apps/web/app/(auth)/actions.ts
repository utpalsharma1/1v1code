"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession, login, register } from "@/lib/auth";

export interface FormState {
  error: string | null;
}

/**
 * Registration and login as server actions.
 *
 * Both deliberately return the *same* shape and never reveal which field was
 * wrong on login — "wrong email or password" rather than "no such user" — so
 * the form cannot be used to enumerate who has an account.
 */
export async function registerAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await register({
    handle: String(form.get("handle") ?? ""),
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
  });

  if (!result.ok) return { error: result.error };
  await createSession(result.userId);
  redirect("/play");
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await login(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  if (!result.ok) return { error: result.error };
  await createSession(result.userId);
  redirect("/play");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

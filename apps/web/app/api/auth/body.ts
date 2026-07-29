/* Accept both a JSON fetch and a plain HTML form post.

   The form used to carry no `method` and no `action`, so when React had not
   hydrated the browser fell back to its default: a GET to the current URL with
   every field in the query string. That produced exactly the reported symptom —
   submitting appears to do nothing, because the page simply reloads — and it
   also wrote the password into the URL bar, browser history and the server log.

   Handling form encoding here lets the form declare `method="post"` and a real
   `action`, so the no-JS path both works and keeps credentials in the body. */

export interface ParsedBody {
  fields: Record<string, string>;
  /** True when the browser submitted the form itself, so we owe it a redirect
   *  rather than JSON — nothing is going to render a JSON response for a user. */
  isFormPost: boolean;
}

export async function parseBody(request: Request): Promise<ParsedBody | null> {
  const type = request.headers.get("content-type") ?? "";

  if (type.includes("application/json")) {
    try {
      const raw = (await request.json()) as unknown;
      if (!raw || typeof raw !== "object") return null;
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === "string") fields[k] = v;
      }
      return { fields, isFormPost: false };
    } catch {
      return null;
    }
  }

  if (
    type.includes("application/x-www-form-urlencoded") ||
    type.includes("multipart/form-data")
  ) {
    try {
      const form = await request.formData();
      const fields: Record<string, string> = {};
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") fields[k] = v;
      }
      return { fields, isFormPost: true };
    } catch {
      return null;
    }
  }

  return null;
}

/** A form post gets a 303 so the browser re-issues it as a GET and the password
 *  never survives a refresh. Errors go back to the form as a query flag, never
 *  with the submitted credentials attached. */
export function formRedirect(request: Request, path: string, error?: string): Response {
  const url = new URL(path, request.url);
  if (error) url.searchParams.set("error", error);
  return Response.redirect(url, 303);
}

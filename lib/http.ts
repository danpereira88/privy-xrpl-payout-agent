import { HttpError } from "./privy";

/** Wrap a route handler so thrown errors become JSON responses. */
export function route(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    try {
      return Response.json(await fn(req));
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      console.error(e);
      return Response.json({ error: e?.message ?? String(e) }, { status });
    }
  };
}

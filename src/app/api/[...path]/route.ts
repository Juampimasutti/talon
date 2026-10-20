import { withErrors } from "@/lib/http";
import { dispatch } from "@/server/dispatch";

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return withErrors(() => dispatch(req.method, path, req));
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;

import { timingSafeEqual } from "crypto";
import { revalidateTag } from "next/cache";
import { PIPELINE_TAG, revalidateToken } from "../../../lib/pipelineCache";

// Called by scripts/tick.ts after each pipeline run: expire every
// pipeline-derived cache so the next visit rebuilds from the fresh data.
// See lib/pipelineCache.ts for the why.
export async function POST(req: Request) {
  const want = revalidateToken();
  const got = req.headers.get("x-yahn-token") ?? "";
  if (
    !want ||
    got.length !== want.length ||
    !timingSafeEqual(Buffer.from(got), Buffer.from(want))
  ) {
    return Response.json({ ok: false }, { status: 401 });
  }
  revalidateTag(PIPELINE_TAG, { expire: 0 });
  return Response.json({ ok: true });
}

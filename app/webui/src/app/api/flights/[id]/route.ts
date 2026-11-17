import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * PATCH /api/flights/[id]
 *   body: any subset of { status, actual_dep, actual_arr, scheduled_dep, scheduled_arr, notes, updated_by }
 *   - delay_minutes is computed automatically when both scheduled_arr and actual_arr are present.
 *   - For 'cancelled' status, delay_minutes is reset to null.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey
  );

  const update: Record<string, unknown> = {
    ...body,
    updated_at: new Date().toISOString(),
  };

  // Normalize ISO timestamps if provided
  for (const k of ["scheduled_dep", "scheduled_arr", "actual_dep", "actual_arr"]) {
    if (update[k] && typeof update[k] === "string") {
      const d = new Date(update[k] as string);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: `invalid ${k}` }, { status: 400 });
      }
      update[k] = d.toISOString();
    }
  }

  // Recompute delay_minutes from actual_arr vs scheduled_arr if either was just sent.
  const scheduled = (update.scheduled_arr ?? null) as string | null;
  const actual = (update.actual_arr ?? null) as string | null;
  if (update.status === "cancelled") {
    update.delay_minutes = null;
  } else if (scheduled && actual) {
    update.delay_minutes = Math.round(
      (new Date(actual).getTime() - new Date(scheduled).getTime()) / 60000
    );
  }

  const { data, error } = await supabase
    .from("flights_to_track")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ flight: data });
}

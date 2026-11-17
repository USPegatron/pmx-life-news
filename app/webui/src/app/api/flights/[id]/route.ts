import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * PATCH /api/flights/[id]
 *   body: any subset of {
 *     status, actual_dep, actual_arr, scheduled_dep, scheduled_arr,
 *     notes, updated_by, airline_name, aircraft_type,
 *     archived: true|false
 *   }
 *   - delay_minutes is computed automatically when scheduled_arr and actual_arr are both present.
 *   - departure_delay_minutes is computed automatically when scheduled_dep and actual_dep are both present.
 *   - For 'cancelled' status, both delay_minutes and departure_delay_minutes are reset to null.
 *   - { archived: true } stamps archived_at to now; { archived: false } clears it.
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
  const scheduledArr = (update.scheduled_arr ?? null) as string | null;
  const actualArr = (update.actual_arr ?? null) as string | null;
  const scheduledDep = (update.scheduled_dep ?? null) as string | null;
  const actualDep = (update.actual_dep ?? null) as string | null;

  if (update.status === "cancelled") {
    update.delay_minutes = null;
    update.departure_delay_minutes = null;
  } else {
    if (scheduledArr && actualArr) {
      update.delay_minutes = Math.round(
        (new Date(actualArr).getTime() - new Date(scheduledArr).getTime()) / 60000
      );
    }
    if (scheduledDep && actualDep) {
      update.departure_delay_minutes = Math.round(
        (new Date(actualDep).getTime() - new Date(scheduledDep).getTime()) / 60000
      );
    }
  }

  // Manual archive toggle: { archived: true } → stamp archived_at; { archived: false } → clear.
  if (update.archived === true) {
    update.archived_at = new Date().toISOString();
    delete update.archived;
  } else if (update.archived === false) {
    update.archived_at = null;
    delete update.archived;
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

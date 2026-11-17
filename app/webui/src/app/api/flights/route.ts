import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * GET /api/flights
 *   ?date=YYYY-MM-DD&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   &archived=false|true|all  (default false)
 *   &limit=N
 *   Reads with the anon key (public read).
 * POST /api/flights — body { ...flight }  -> insert one (service_role)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const archived = searchParams.get("archived") ?? "false";
  const limit = Math.min(parseInt(searchParams.get("limit") || "200", 10), 500);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  let query = supabase
    .from("flights_to_track")
    .select("*")
    .order("flight_date", { ascending: true })
    .order("scheduled_dep", { ascending: true })
    .limit(limit);

  if (date) query = query.eq("flight_date", date);
  if (from) query = query.gte("flight_date", from);
  if (to) query = query.lte("flight_date", to);

  // Default: exclude archived flights (archived_at IS NULL).
  if (archived === "false") {
    query = query.is("archived_at", null);
  } else if (archived === "true") {
    query = query.not("archived_at", "is", null);
  }
  // "all" → no extra filter.

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ flights: data || [] });
}

export async function POST(req: Request) {
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
  const { data, error } = await supabase
    .from("flights_to_track")
    .insert(body)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ flight: data });
}

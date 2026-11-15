import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const TARGET_CODES: Record<string, string> = { zh: "ZH-HANT", es: "ES", en: "EN" };

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const lang = searchParams.get("lang") || "";
  if (!id || !(lang in TARGET_CODES)) {
    return NextResponse.json({ error: "missing or invalid id/lang" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const deeplKey = process.env.DEEPL_API_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("news_items")
    .select(
      "id,language_original,content_original,content_zh,content_es,summary_en,summary_zh,summary_es"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const origLang = (data.language_original || "en").toLowerCase();
  const original = (data.content_original || "").trim();
  const fallback = (data as Record<string, unknown>)[`summary_${lang}`] as string | null
    || (data.summary_en as string | null)
    || "";

  // Same as original language → no translation needed.
  if (lang === origLang) {
    const text = original || fallback;
    return NextResponse.json({ content: text, original: text, translated: false });
  }

  const cacheField = lang === "zh" ? "content_zh" : lang === "es" ? "content_es" : null;
  const cached = cacheField ? ((data as Record<string, unknown>)[cacheField] as string | null) : null;
  if (cached && cached.trim()) {
    return NextResponse.json({ content: cached, original: original || fallback, translated: true, cached: true });
  }

  if (!original) {
    return NextResponse.json({ content: fallback, original: fallback, translated: false, note: "no full text" });
  }
  if (!deeplKey) {
    return NextResponse.json({ content: original, original, translated: false, note: "DeepL not configured" });
  }

  try {
    const sourceLang = origLang === "es" ? "ES" : origLang === "zh" ? "ZH" : "EN";
    const translated = await deeplTranslate(original, sourceLang, TARGET_CODES[lang], deeplKey);
    if (cacheField && translated) {
      await supabase.from("news_items").update({ [cacheField]: translated }).eq("id", id);
    }
    return NextResponse.json({ content: translated, original, translated: true, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      content: original,
      original,
      translated: false,
      note: `translation failed: ${msg}`,
    });
  }
}

async function deeplTranslate(
  text: string,
  source: string,
  target: string,
  key: string
): Promise<string> {
  const endpoint = key.endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";

  const body = new URLSearchParams();
  body.append("text", text);
  body.append("source_lang", source);
  body.append("target_lang", target);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`DeepL ${res.status}: ${t.slice(0, 180)}`);
  }
  const json = await res.json();
  return json?.translations?.[0]?.text ?? "";
}

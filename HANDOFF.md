# PMX Border & Flight — HANDOFF

> 此文件是專案的「交接書」。任何新的 OpenCode session 開始時，**先讀這份文件**再動手。

---

## 🔴 時刻提醒（CRITICAL REMINDERS）

### 1. 24/7 航班自動更新 = 方案 A（Python daemon 跑在用戶 PC）
- **已決定**：用戶 PC 上跑 `python app/flight_tracker/flight_tracker.py`（24/7）
- OpenSky Network（免費、無 API key）偵測起飛/降落
- 15-min cycle，bbox + callsign match
- **Estimated time（預計抵達）OpenSky 給不了** — 目前靠手動 backfill（叫 OpenCode 用 web search 查）
- **後續待討論**：AviationStack API（~$50/月）或免費 VM（Oracle/GCP）
- ⚠️ **不要**再嘗試 Vercel Cron（Hobby plan 不支援）
- ⚠️ **不要**在 vercel.json 加 cron 設定（之前因此 build 失敗）

### 2. 時區顯示規則（絕對不可違反）
- DB 存 **UTC timestamptz**（Supabase 自動轉，offset 會丟）
- 前端用 `AIRPORT_TZ` map（IATA → IANA）+ `Intl.DateTimeFormat({timeZone})` 轉成機場當地時間
- **絕不用** `new Date().getHours()`（瀏覽器時區）
- **絕不用** regex 從 ISO literal 抓 HH:mm（因為 DB 回傳的是 UTC，不是原始 offset）
- 延遲計算：`(actual - scheduled)` 的 UTC 差值 = 當地時間差值（同一機場）

### 3. 燈號邏輯（用戶明確定義，不可改）
```
左側（未起飛，actual_dep = null）：空心圓
右側（已起飛，actual_dep 有值）：
  綠燈: |actual - scheduled| ≤ 15 min（提早也算綠）
  黃燈: 延遲 15~30 min
  紅燈(閃爍): 延遲 > 30 min
  黑燈(閃爍): cancelled
```
- 左側看 departure delay，右側看 arrival delay
- **沒有藍燈**
- 判定右側的條件：**只看 `actual_dep` 有沒有值**（不看時間是否過 scheduled_dep）

### 4. 手機 vs 桌面
- 機型（aircraft_type）：`hidden lg:inline`（row 1）+ `lg:hidden`（獨立行）— **lg: breakpoint (1024px)**
- Dep/Arr row 2：`flex flex-col lg:flex-row`（手機堆疊，桌面並排）
- 用戶手機 viewport ≥ 768px（md 不夠，要用 lg）

### 5. Build 工作流
```powershell
$nodebin="C:\Users\Jacky2_Wang\.config\opencode\skills\portable-nodejs\bin\node-v24.14.1-win-x64"
$env:Path = "$nodebin;$env:Path"
# 必須先清 .next（OneDrive 檔案鎖）
Remove-Item -Recurse -Force ".next" -ErrorAction SilentlyContinue
& "$nodebin\npm.cmd" run build
```
- 普通 `npm run build` 會失敗（PowerShell execution policy 擋 npm.ps1）
- Git push：
```powershell
$git = "$env:LOCALAPPDATA\PortableGit\cmd\git.exe"
$ca = "C:\Users\Jacky2_Wang\.config\opencode\skills\pega-oa-network-proxy\scripts\cacert.pem"
& $git -c http.sslCAInfo="$ca" -c http.proxy="http://localhost:3128" -c https.proxy="http://localhost:3128" push origin main
```

### 6. Supabase REST 寫入
- 必須用 **Python**（`requests`），不能用 PowerShell curl.exe（JSON body 會被搞壞 → PGRST102）
- 環境變數：`$env:REQUESTS_CA_BUNDLE` + `$env:HTTPS_PROXY="http://localhost:3128"`
- `.env` 在 `app/crawler/.env`（gitignored）

---

## 架構總覽

```
┌────────────────────────────┐     ┌─────────────────┐     ┌──────────────────────┐
│ 用戶 PC (24/7 daemon)      │     │ Supabase Free   │     │ Vercel Hobby         │
│ flight_tracker.py          │────▶│ flights_to_track│◀────│ Next.js 15 (webui)   │
│  OpenSky 15-min cycle      │     │ news_items      │     │  /  (新聞+航班)      │
│  bbox+callsign → dep/arr   │     │ (RLS)           │     │  /history (歷史)     │
└────────────────────────────┘     └─────────────────┘     └──────────────────────┘
        ▲                                                        │
        │          ┌──────────────────┐                         │
        └──────────│ GitHub Actions   │─────────────────────────┘
                   │ crawler (hourly) │
                   │ RSS → DeepL → DB │
                   └──────────────────┘
```

### 技術棧
| 層 | 技術 |
|---|---|
| Frontend | Next.js 15 (App Router) + Tailwind CSS + React |
| Backend (API routes) | Next.js API routes (TypeScript) |
| DB | Supabase (PostgreSQL) — timestamptz |
| Translation | DeepL Free (ZH-HANT) |
| Flight tracking | OpenSky Network (free, no key) |
| News crawler | Python (RSS + DeepL) via GitHub Actions |
| Flight daemon | Python (OpenSky) on user's PC |
| Deploy | Vercel Hobby (auto-deploy from GitHub) |
| Repo | github.com/USPegatron/pmx-life-news (public) |

---

## 關鍵檔案

| 檔案 | 用途 |
|---|---|
| `app/webui/src/components/FlightsView.tsx` | 航班追蹤主 UI（卡片、燈號、modal、CSV import） |
| `app/webui/src/lib/utils.ts` | AIRLINE_NAMES, AIRCRAFT_NAMES, flightDepLight, flightArrLight, i18n |
| `app/webui/src/lib/types.ts` | Flight interface |
| `app/webui/src/app/history/page.tsx` | 歷史紀錄頁（archived flights） |
| `app/webui/src/app/page.tsx` | 新聞主頁 |
| `app/webui/src/app/api/flights/check-now/route.ts` | OpenSky check（POST "更新全部" + GET） |
| `app/webui/src/app/api/flights/import/route.ts` | CSV import（3/5/7 cols） |
| `app/flight_tracker/flight_tracker.py` | 24/7 Python daemon（OpenSky, 15-min cycle） |
| `app/flight_tracker/opensky_provider.py` | OpenSky bbox + callsign match |
| `app/flight_tracker/flight_enricher.py` | 導出待 enrichment 的 flights (JSON) |
| `app/flight_tracker/apply_enrichment.py` | 讀 enrichment JSON → PATCH Supabase |
| `app/crawler/main.py` | RSS 爬蟲 |
| `app/crawler/filters.py` | 相關性過濾（100-mile, aviation keywords） |
| `app/crawler/.env` | 環境變數（gitignored） |
| `app/supabase/schema_v6_flights.sql` | 最新 migration |

---

## FlightsView.tsx 時間 helper（檔案頂端）

```typescript
const AIRPORT_TZ: Record<string, string> = { TPE: "Asia/Taipei", LAX: "America/Los_Angeles", ... };

function fmtClock(iso: string | null, airportCode: string | null | undefined): string
  // Intl.DateTimeFormat({timeZone}) → HH:mm in airport local

function fmtDate(iso: string | null): string
  // regex M/D from ISO literal (safe: date portion doesn't change with tz)

function isoToLocalInput(iso: string | null, airportCode: string | null | undefined): string
  // For <input type="datetime-local"> — renders in airport tz

function localInputToIso(local: string | null, airportCode: string | null | undefined, originalIso?: string | null): string | null
  // Saves with airport tz offset (preserves originalIso offset if available)

function getTzOffsetString(tz: string, ref?: Date): string
  // IANA tz → "+08:00" / "-07:00" offset string
```

---

## 燈號與狀態邏輯（utils.ts）

```typescript
function flightDepLight(flight, now): "hollow" | "green" | "yellow" | "red" | "black"
  // hollow: actual_dep = null (尚未起飛)
  // else: delay = (actual_dep - scheduled_dep) in minutes
  //   ≤15 → green, 15-30 → yellow, >30 → red+flash
  //   status=cancelled → black+flash

function flightArrLight(flight, now): "hollow" | "green" | "yellow" | "red" | "black"
  // hollow: actual_dep = null (尚未起飛)
  // else: delay = (actual_arr - scheduled_arr) in minutes
  //   same thresholds as dep
```

**Column split**：`f.actual_dep` 有值 → 右側（已出發），null → 左側（待出發）
**Status label**：
- `actual_dep = null` → 待出發
- `actual_dep` set, `actual_arr` null → 已起飛 / 飛行中
- `actual_arr` set, `actual_arr <= now` → 已抵達

---

## 卡片結構（row 1 + row 2）

```
Row 1: [●] 2026-11-17 / BR12 / EVA Air / Boeing 777-300ER  [✈️/🏢] [更新]
Row 2 (mobile: stacked / desktop: side-by-side):
  Dep:  TPE 11/17 19:40 → 19:50 延遲 10Min
  Arr:  LAX 11/17 15:20 → 15:23 提早 2Min  [icon]
```

- Row 1: `flex items-center gap-2`，dot(w-3) + meta(flex-1 truncate) + icon + button
- Row 2: `flex flex-col lg:flex-row`
  - Dep: `w-full lg:w-1/2 pl-5`（pl-5 = 20px = dot+gap，對齊 row 1 日期）
  - Arr: `w-full lg:w-1/2 pl-5 lg:pl-0`（手機也 pl-5 對齊，桌面在中線）

---

## 已知限制 & 待解決

| 項目 | 狀態 | 備註 |
|---|---|---|
| 24/7 auto-update | ⚠️ 需用戶 PC 開著跑 daemon | 方案 A；後續討論 AviationStack / 免費 VM |
| Estimated time (in-flight) | ❌ OpenSky 給不了 | 需付費 API 或手動 backfill |
| Vercel Cron | ❌ Hobby plan 不支援 | 不要再嘗試 |
| 手機 viewport | ✅ lg: breakpoint (1024px) | 用戶手機 ≥ 768px |
| Supabase timestamptz | ⚠️ offset 丟失 | 前端用 AIRPORT_TZ 重構 |

---

## 用戶偏好

- 語言：**繁體中文**（所有 UI 文字、翻譯目標 ZH-HANT）
- 風格：精簡、不浪費空間、一行之內能放完
- 時間顯示：機場當地時間（絕不是瀏覽器時區、絕不是 UTC）
- 燈號：用戶有精確定義（見上方），不要自行發明新顏色
- 準點判定：只有 actual === scheduled（差 0 min）才叫準點，差 1 分鐘就是提早/延遲
- 航班上傳：最小 3 欄（日期/航空公司代號/航班編號），系統 enrich 其餘
- 不需重複上傳：flight 留在 DB 直到 archived（抵達後 1hr）

---

## 最近 commits（供 context）

- `bdcbc20`: mobile stacks dep/arr vertically (flex-col), desktop side-by-side (lg:flex-row)
- `9bc5192`: align dep IATA with row1 date (pl-5), arr at 50% midline
- `09330d6`: column split + dep light use actual_dep ONLY
- `92a2960`: news label overlap fix (mobile bottom, desktop top)
- `caedd27`: status icons in row 1 + /history page
- `d3776f2`: alignment fix (text-left)
- `da03374`: center dep/arr + status icons
- `f71e759`: 準點 only when exact match
- `135ca27`: removed vercel.json
- `a2b0d6f`: display UTC in airport timezone + daemon stamps actual_dep/arr

---

## 如何啟動 daemon

```powershell
# 前置：安裝依賴
pip install requests python-dotenv

# 啟動（24/7）
$env:REQUESTS_CA_BUNDLE = "C:\Users\Jacky2_Wang\.config\opencode\skills\pega-oa-network-proxy\scripts\cacert.pem"
$env:HTTPS_PROXY = "http://localhost:3128"
$env:HTTP_PROXY = "http://localhost:3128"
python app\flight_tracker\flight_tracker.py
```

Daemon 行為：
- 每 15 分鐘掃一次 OpenSky
- 對每筆 active flight：查 origin/destination airport bbox 內有沒有 matching callsign
- 偵測到起飛 → 寫 `actual_dep`（UTC now）
- 偵測到降落 → 寫 `actual_arr`（UTC now）+ `archived_at`（now + 1hr 後自動歸檔）
- 寫入用 Supabase REST（service_role key）

agents.md    - the file to record detail about this project.
handoff.txt  - while I do save this handoff, please run "/handoff" then save it to this txt.
start.bat    - if any software and PY server generated, use the bat to start it.

app          - the folder contains all software/code/library/server files.
app\backup   - any exe/html/UI will be always backup here with revision control by rYYMMDD.hhmmss
               always backup while new UI/app generated
data         - for project source input
log          - all applicatin procedure/process must be with operation/error log here
report	     - all generated report, save here

-------------- Don't over write my rule above this line ----------------

## Project: PMX Border & Flight Hub（2026-11-14 啟動 / 2026-11-15 上線 / 2026-11-17 完整版）

用途：給 PMX 公司出差員工用的雙用途工具——
1. **新聞聚合**：每小時自動蒐集 El Paso / Juárez 在地（含工作/生活）新聞 + 全球航空（僅限與搭機/機場/航班相關），相關性過濾後用 DeepL 翻譯成 繁中/英/西 三語，存入 Supabase，Vercel 上公開瀏覽；點卡片可「按需」翻譯並快取全文。
2. **航班追蹤**：員工出差或派駐用的航班，行政人員貼 CSV 上傳 → 自動在兩欄 UI 顯示（待出發 / 已出發）；OpenSky Network API 每 15 分鐘自動確認「飛機是否在空中」，無法確認時由人工按鈕手動更新燈號（綠/藍/黃/紅/黑閃爍 + 空心）。

### 架構
- `app\crawler`           — Python 爬蟲（GitHub Actions 每整點）：RSS x11 → 去重 → 相關性過濾 → DeepL → 寫 Supabase
- `app\webui`             — Next.js 15（Vercel 部署，root dir = `app/webui`）；新聞 tab（三語 + 搜尋 + 主題/時間過濾 + 卡片 + 閱讀視窗 + 全文翻譯 + 多圖輪播）；航班 tab（兩欄 + 雙燈號 + 上傳/更新）；底部切換
- `app\webui\src\app\api\translate` — 全文翻譯 server route（需 DEEPL_API_KEY + SUPABASE_SERVICE_ROLE_KEY）
- `app\webui\src\app\api\flights`   — 航班 CRUD：GET 列表/篩選已備份、POST 匯入（接受 5/7 欄 CSV，含美式日期）、PATCH 更新（自動算延誤分鐘、1 小時後自動備份）
- `app\webui\src\components\FlightsView.tsx` — 兩欄航班 UI（含 ImageCarousel + 多圖輪播）
- `app\flight_tracker`     — Python daemon（跑在員工 24x7 電腦）：每 15 分鐘從 Supabase 撈「未出發/未到」的航班 → OpenSky Network bbox 查詢 → 匹配 callsign → 寫回 status / actual_dep / actual_arr / delay_minutes
- `app\supabase`           — 5 個 schema（`schema.sql`、`schema_v2_content.sql`、`schema_v3_images.sql`、`schema_v4_flights.sql`、`schema_v5_flight_tracker.sql`、`schema_v6_flights.sql`）；RLS 公開唯讀，寫入限 service_role
- `.github\workflows\crawler.yml` — cron `0 * * * *`；⚠️ GitHub repo 必須 public 才有免費 Actions 分鐘數

### 技術選擇與理由
- **新聞翻譯：DeepL Free API** — 品質最高的中英西翻譯；免費 100 萬字/月（non-commercial ToS，PMX 為公司應升級 Pro ≈ $0.18/月）
- **航班資料：OpenSky Network API** — 免費、全球、即時 ADS-B；只給位置不給預定/實際時間差，所以**延誤分鐘由人工填**或 daemon 不填
- **全文翻譯：按需 + 快取** — Gemini + Google Search 試過（要 billing）、DuckDuckGo 爬蟲試過（被擋）、AeroAPI 要 $89/月 → 最終採「點開才翻、寫回 DB 永久免費」的方案
- **持久 Git 憑證** — `%USERPROFILE%\.git-credentials` + `credential.helper=store`；PortableGit 系統設定的 `manager` 已停用（會攔截）；push 走 OA proxy http://localhost:3128 + cacert.pem

### Feed 與過濾規則
- **Border x6**：El Paso Matters、KVIA ABC-7 El Paso、Norte Digital、La Verdad Juárez、El Fronterizo、Juárez Noticias（皆 RSS 含全文）
- **Aviation x5**：Simple Flying、Aviation Pros、The Aviationist、FlightAware Blog、The Air Current（僅 Aviationist 與 FlightAware 有全文）
- `filters.py` 規則（皆調校過，避免 UTEP football / DC 政治 / 法國航空母艦 等漏網）：EXCLUDE_KEYWORDS（運動/娛樂/名人/星座/彩券）、LOCAL_SOURCES（純在地來源白名單）、LOCAL_SIGNALS（在地關鍵字門檻，混和來源如 KVIA 需含才留）、AVIATION_RELEVANCE_KEYWORDS（僅航班問題/政策）

### 狀態（2026-11-17 最終版）
- **新聞**：55 筆相關資料，每筆含原文（content_original）+ 三語標題摘要
- **航班**：DB 空（等真實資料上傳）；OpenSky daemon 在 24x7 電腦上跑
- **Schema v6**：`flights_to_track` 已加 `airline_name`/`aircraft_type`/`departure_delay_minutes`/`archived_at` + `last_checked_at`
- **航班 UI**：兩欄（待出發/已出發）；左燈 = 起飛狀態（空心/藍/綠/黃/紅/黑閃），右燈 = 抵達狀態（藍/綠/黃/紅/黑閃）

### 憑證（皆已就位，**實際值不寫入本檔**）
- Supabase：PMX-News（ref `xahuxyrnyzaeosecziwz`，us-east-1）
- DeepL：免費 key（`:fx`，100 萬字/月）
- Gemini：免費 key（已啟用，但 billing cap 不可設定，暫時未用）
- GitHub：`USPegatron/pmx-life-news`（public）
- Vercel：Hobby（root `app/webui`）

### 憑證位置（皆 gitignored / 雲端 Secret）
- 本機：`app\crawler\.env`（SUPABASE_URL/SERVICE_ROLE/DEEPL/GEMINI）、`app\webui\.env.local`（NEXT_PUBLIC_*）、`data\supabase\`、根目錄 `*.txt` 登入備註
- GitHub repo Secrets：3 個（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DEEPL_API_KEY）
- Vercel env（Production Secret）：2 個（DEEPL_API_KEY / SUPABASE_SERVICE_ROLE_KEY）+ 2 個 NEXT_PUBLIC_*

### 已知限制 / 待辦（給公司評估）
- DeepL Free API 是 non-commercial ToS；公司正式使用應升級 Pro
- Vercel Hobby 條款限個人/非商業；公司內部用建議升級 Pro
- OpenSky 只能給位置，無法算延誤分鐘 → 仍需人工標記抵達時間
- 持久 Git 憑證存在本機（個人帳號）；公司接手應改企業 GitHub/Vercel/Supabase 帳號
- 11 feeds 中 KVIA 會轉載 CNN 國家新聞，過濾關鍵字需持續觀察與調校

### 本機執行工具
- Python 3.13（系統裝的）；crawler / flight_tracker 用的套件（requests、python-dotenv、feedparser、supabase-py）已 pip install
- Portable Node：`C:\Users\Jacky2_Wang\.config\opencode\skills\portable-nodejs\bin\node-v24.14.1-win-x64`（build webui 用）
- Portable Git：`%LOCALAPPDATA%\PortableGit\cmd\git.exe`
- OA proxy + CA：`http://localhost:3128` + `C:\Users\Jacky2_Wang\.config\opencode\skills\pega-oa-network-proxy\scripts\cacert.pem`
- start.bat：本地選單（跑爬蟲 / dry-run / webui dev / build）
- `app\flight_tracker\run_tracker.bat`：航班 daemon 啟動器

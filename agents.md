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

## Project: Border & Flight News Hub（2026-11-14 啟動）

用途：每小時自動蒐集 El Paso (TX) / Juárez (MX) 重大民生新聞 + 全球飛航（僅與搭機/機場/航班相關）新聞，
先做相關性過濾（聚焦 Juárez/El Paso 工作與生活），再由 DeepL 翻譯成 中(繁體)/英/西 三語（含圖片）存入 Supabase，由 Vercel 上的 Web UI 公開瀏覽。
使用者點開文章時，再「按需」翻譯並快取完整全文（不只摘要）。

### 架構（本資料夾 = 最終專案位置，git repo root）
- `app\crawler`    — Python 爬蟲（GitHub Actions 每整點跑）：RSS x11 feeds → 去重 → 相關性過濾(`filters.py`) → DeepL 翻譯 → 寫入 Supabase（另存 `content_original` 全文）
- `app\webui`      — Next.js 15（Vercel 部署，root dir = `app/webui`）；三語切換 + 搜尋 + 主題/時間過濾；點卡片 → `/api/translate` 按需全文翻譯（server route，需 DEEPL_API_KEY + SUPABASE_SERVICE_ROLE_KEY）
- `app\supabase`   — `schema.sql`（news_items 表 + RLS：public read only，寫入僅 service_role）
- `.github\workflows\crawler.yml` — cron `0 * * * *`；⚠️ GitHub repo 必須 public 才有免費分鐘數
- `data\`          — source input（目前保留；feeds 定義在 `app\crawler\feeds.py`）
- `log\`           — 爬蟲執行日誌（`crawler_YYYYMMDD_HHMMSS.log`，本地執行時產生）
- `report\`        — 保留
- `start.bat`      — 本地選單：1) 跑一次爬蟲 2) 爬蟲 dry-run 3) webui dev 4) webui build 5) 開資料夾

### 憑證（皆已建立；實際值不寫入本檔，位置見狀態區）
- Supabase：PMX-News（ref `xahuxyrnyzaeosecziwz`）；anon key 在 webui env，service_role 只在 GitHub secrets / Vercel env
- DeepL 免費 key（`:fx`，帳號顯示 100 萬字/月；按需翻譯＋快取，用量省）
- GitHub `USPegatron/pmx-life-news`（public）+ Vercel（root dir `app/webui`）

### Feed 清單（2026-11-14 全部 HTTP 實測通過，詳見 `app\crawler\feeds.py` 註解）
- Border x6：El Paso Matters, KVIA ABC-7 El Paso, Norte Digital, La Verdad Juárez, El Fronterizo, Juárez Noticias
  （原候補 El Paso Tribune/El Paso Times/El Vigía/El Diario/La Opinión 因 dead domain / 402 / 403 / 無 RSS 而替換）
- Aviation x5：Simple Flying, Aviation Pros, The Aviationist, FlightAware Blog, The Air Current

### 狀態（2026-11-15 全功能上線）
- [完成] 全服務上線：Supabase(PMX-News) + DeepL + GitHub Actions(每小時) + Vercel(https://pmx-life-news.vercel.app)
- [完成] 爬蟲：11 feeds；修正 `main.py` 缺 `log` logger、`translate.py` 改 `Authorization: DeepL-Auth-Key`；另存 `content_original` 全文
- [完成] 相關性過濾 `filters.py`：聚焦 Juárez/El Paso 工作生活；航空只留搭機/機場/航班相關；排除運動/娛樂/名人/星座/彩券；KVIA 等混合來源需含在地訊號
- [完成] 中文一律繁體（DeepL target `ZH-HANT`；UI 亦繁體）；三語切換 / 搜尋 / 主題時間過濾
- [完成] 按需全文翻譯：點卡片 → `/api/translate`（server route）→ 翻譯並快取 DB（`content_zh`/`content_es`）；實測繁中/西語全文 OK、二次命中快取
- 目前資料約 55 筆（過濾後，全部含全文）
- 憑證位置（皆 gitignored / 雲端 Secret，勿 commit）：`app\crawler\.env`、`app\webui\.env.local`、`data\supabase\`、根目錄 `*.txt`；GitHub Secrets 3 個；Vercel env：2 個 server secret + 2 個 `NEXT_PUBLIC_*`
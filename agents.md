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

用途：每小時自動蒐集 El Paso (TX) / Juarez (MX) 重大民生新聞 + 全球飛航重大新聞，
經 DeepL 翻譯成 中/英/西 三語（含圖片），存入 Supabase，由 Vercel 上的 Web UI 公開瀏覽。

### 架構（本資料夾 = 最終專案位置，git repo root）
- `app\crawler`    — Python 爬蟲（GitHub Actions 每整點跑）：RSS x11 feeds → 去重 → DeepL 批次翻譯 → 寫入 Supabase
- `app\webui`      — Next.js 15（Vercel 部署，root dir = `app/webui`）；anon key 公開只讀；三語切換 + 搜尋 + 主題/時間過濾
- `app\supabase`   — `schema.sql`（news_items 表 + RLS：public read only，寫入僅 service_role）
- `.github\workflows\crawler.yml` — cron `0 * * * *`；⚠️ GitHub repo 必須 public 才有免費分鐘數
- `data\`          — source input（目前保留；feeds 定義在 `app\crawler\feeds.py`）
- `log\`           — 爬蟲執行日誌（`crawler_YYYYMMDD_HHMMSS.log`，本地執行時產生）
- `report\`        — 保留
- `start.bat`      — 本地跑爬蟲 / 啟動 webui（待補寫）

### 憑證（皆待用戶建立，詳見 README.md）
- Supabase：Project URL + anon key（webui env）+ service_role key（只放 GitHub secrets）
- DeepL 免費 key（結尾 `:fx`；500k 字元/月；ToS 非商業，公司正式使用建議日後付費）
- GitHub public repo + Vercel（import repo，root dir `app/webui`）

### Feed 清單（2026-11-14 全部 HTTP 實測通過，詳見 `app\crawler\feeds.py` 註解）
- Border x6：El Paso Matters, KVIA ABC-7 El Paso, Norte Digital, La Verdad Juárez, El Fronterizo, Juárez Noticias
  （原候補 El Paso Tribune/El Paso Times/El Vigía/El Diario/La Opinión 因 dead domain / 402 / 403 / 無 RSS 而替換）
- Aviation x5：Simple Flying, Aviation Pros, The Aviationist, FlightAware Blog, The Air Current

### 狀態（2026-11-14 全線上線完成）
- [完成] 專案已搬遷至本資料夾；`app\crawler`、`app\webui`、`app\supabase`、`.github` 全部就位；`start.bat` 完成
- [完成] 爬蟲：11 feeds 實測通過；修正 `main.py` 缺 `log` logger、`translate.py` DeepL 認證改為 `Authorization: DeepL-Auth-Key` 標頭（DeepL 已移除 form auth_key）
- [完成] Supabase：專案 PMX-News（ref `xahuxyrnyzaeosecziwz`，us-east-1），`schema.sql` 已部署，`news_items` 已有多筆資料
- [完成] GitHub：`github.com/USPegatron/pmx-life-news`（public）；Actions cron 每小時；3 個 secrets（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DEEPL_API_KEY）；手動 run 實測成功（85 筆三語）
- [完成] Vercel：`https://pmx-life-news.vercel.app`（Hobby，root dir `app/webui`）；線上三語切換 / 搜尋 / 主題時間過濾正常
- 憑證檔（皆 gitignored，勿 commit）：`app\crawler\.env`、`app\webui\.env.local`、`data\supabase\`、根目錄 `*.txt` 登入備註
# Border & Flight News Hub

每小時自動搜尋 **El Paso (TX) / Juárez (MX)** 重大民生新聞 + **全球飛航**重大新聞，
翻譯成 **中 / 英 / 西** 三語（含圖片），存入 Supabase，並透過部署在 Vercel 的 Web UI 公開瀏覽。

## 架構

```
┌─────────────────────────┐      ┌──────────────┐      ┌─────────────────────┐
│ GitHub Actions (cron)   │      │ Supabase     │      │ Vercel (Next.js)    │
│ crawler/main.py         │─────▶│ news_items   │◀─────│ webui/  (anon key,  │
│  RSS fetch → dedupe →   │      │ (RLS: public │      │  public read)       │
│  DeepL translate → DB   │      │  read only)  │      │  中/EN/ES + 搜尋    │
└─────────────────────────┘      └──────────────┘      └─────────────────────┘
```

- **app/crawler/** — Python 爬蟲：RSS 抓取（邊境城市媒體 + 航空媒體）→ 去重（URL sha256）→ DeepL 批次翻譯 → 寫入 Supabase。
- **app/webui/** — Next.js 15 App：讀 Supabase（anon key），三語切換、搜尋、主題/時間過濾、圖片卡片。
- **app/supabase/schema.sql** — 資料庫結構（含 RLS：公開只讀，寫入僅限 service_role）。

## 部署步驟（一次性設定）

### 1. Supabase
1. 到 [supabase.com](https://supabase.com) → New project（免費方案即可），選一個 region 與資料庫密碼。
2. 等專案建立完成後，進入 **SQL Editor → New query**，把 `app/supabase/schema.sql` 的內容貼上並 **Run**。
3. 記下三個值（**Project Settings → API**）：
   - `Project URL`（形如 `https://xxxx.supabase.co`）
   - `anon / public key`
   - `service_role key`（⚠️ 只能放在 GitHub Secrets，絕不可放進 webui 前端）

### 2. DeepL（翻譯）
1. 到 [deepl.com/free](https://www.deepl.com/en/www-free) 註冊免費方案。
2. **Dashboard → API keys → Create new API key**，記下 key（免費 key 結尾是 `:fx`）。
3. ⚠️ 免費方案限制：每月 50 萬字元、非商業用途。本專案用量很小（每日通常 < 5 萬字元），但請注意 DeepL ToS 的「非商業」條款；若屬公司正式用途，建議日後升級付費。

### 3. GitHub（爬蟲排程）
1. 建立新的 repository（例如 `border-aviation-news`），把本資料夾 push 上去：
   ```powershell
   cd border-aviation-news
   git init
   git add .
   git commit -m "init: border & aviation news hub"
   git branch -M main
   git remote add origin https://github.com/<you>/border-aviation-news.git
   git push -u origin main
   ```
2. 到 repo 的 **Settings → Secrets and variables → Actions → New repository secret**，建立三個 secrets：
   | Secret | 值 |
   |---|---|
   | `SUPABASE_URL` | Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
   | `DEEPL_API_KEY` | DeepL API key（含 `:fx` 結尾） |
3. 排程已內建於 `.github/workflows/crawler.yml`（每整點執行）。
   第一次可手動觸發驗證：**Actions → news-crawler → Run workflow**。
   到 Supabase **Table Editor → news_items** 確認有資料寫入。

### 4. Vercel（Web UI）
1. 到 [vercel.com](https://vercel.com) → **Add New → Project** → Import 該 GitHub repo。
2. 設定：
   - Framework Preset: **Next.js**
   - Root Directory: **`app/webui`**
   - Environment Variables:
     | 變數 | 值 |
     |---|---|
     | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
     | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase **anon** key |
3. Deploy。完成後網址即為公開入口；之後每次 push 到 main 會自動重新部署。

## 日常使用

- 新聞每小時自動更新（GitHub Actions cron；GitHub 的 cron 可能延遲數分鐘，屬正常）。
- 想立刻更新：Actions → news-crawler → Run workflow（手動觸發）。
- 想換/加新聞來源：編輯 `app/crawler/feeds.py`（每筆含 name / url / topic / lang），push 即生效。
  - `topic`: `border`（El Paso/Juárez）或 `aviation`（全球飛航）
  - `lang`: 原文語言（`en` / `es`），決定翻譯方向
- 想看目前抓了哪些 feed、執行成敗：Actions 分頁的每次 run 日誌。

## 資料量與配額

| 項目 | 用量 |
|---|---|
| DeepL 免費額度 | 500k 字元/月；本專案估計 < 50k/月 |
| Supabase 免費額度 | 500MB DB、2GB 流量；足夠 |
| Vercel 免費額度 | 100GB 流量；足夠 |
| GitHub Actions 免費額度 | 每月 2,000 分鐘（本專案 ~ 2 分鐘/次 × 720 次 ≈ 1,440 分鐘）⚠️ 接近上限，若 repo 為 private 則免費額度為 0，需用 public repo |

> ⚠️ **GitHub Actions 免費分鐘數只對 public repo 提供**。本專案建議用 **public repo**
>（新聞內容與 anon key 本身是公開可讀的，service_role key 在 secrets 中不外洩，可接受）。

## 故障排查

| 症狀 | 檢查 |
|---|---|
| 網站顯示「No news yet」 | Actions 是否成功跑過？Supabase `news_items` 有資料嗎？ |
| Actions 失敗 | 看日誌：通常是 secret 沒設對（401/400）、或某支 feed 掛了（個別 feed 失敗不會中斷整次執行） |
| 某則新聞沒有翻譯 | DeepL 當次失敗時會fallback存原文；下次執行不會重翻（已去重）。屬少數情況，可忽略 |
| 圖片不顯示 | 部分媒體圖片有 hotlink 保護；會顯示占位圖，不影響其他內容 |
| 想清空重新抓 | Supabase Table Editor 清空 `news_items`（或 SQL `truncate public.news_items`），下次 cron 會重新灌入 |

# Flight Detail — 對話逐字稿

**日期：** 2026/11/17

---

**使用者：**
11/17 WN2915 告訴我這個航班的出發/抵達時間

**助理：**
WN2915（Southwest Airlines）— 2026/11/17（二）

- 航段：洛杉磯 LAX（T1）→ 厄爾帕索 El Paso ELP
- 起飛時間：07:30 PST（太平洋時間，UTC−8）
- 抵達時間：10:25 MST（山地時間，UTC−7）
- 飛行時間：約 1 小時 55 分（跨 1 個時區）
- 班機/機型：Boeing 737-8（N8996Q）
- 即時狀態：準時（On-time）

說明：
- 起飛用太平洋時間、抵達用山地時間（El Paso 比 LAX 慢 1 小時），所以牆上時間差約 2 小時 55 分，實際空航約 1 小時 55 分。
- 航班編號 Southwest 會按季調整航線（WN2915 過去也飛過 LAX→ELP、MDW→MCI 等），以上為 11/17 當天的排定航段。
- 門號與即時延誤請以南航官方（Southwest App / southwest.com）或機場資訊為準。

資料來源：AirNav Radar、flight.info 的 2026-11-17 排班。

---

**使用者：**
幫我把這筆對話存成一個 Flight Detail.md
D:\00_OneDrive\OneDrive - PEGATRON CORPORATION\00_PEGAAi\Project\PMX - Life News\data

**助理：**
已存檔完成。
Flight Detail.md 已建立於：
D:\00_OneDrive\OneDrive - PEGATRON CORPORATION\00_PEGAAi\Project\PMX - Life News\data\Flight Detail.md

---

**使用者：**
我要純對話逐字稿

**助理：**
（將本檔改寫為純對話逐字稿）

---

**使用者：**
你怎麼查的, 也要寫入md

**助理：**
查詢步驟如下（依實際執行順序）：

1. **並行網路搜尋**（websearch，兩筆同時）：
   - 「WN2915 Southwest flight status route schedule」
   - 「WN 2915 Southwest Airlines departure arrival time」
2. **發現航線不一致**：搜尋結果顯示 WN2915 在不同日期飛不同航段（LAX→ELP、MDW→MCI、MSY→AUS、MDW→BUR 等），判斷為 Southwest 依季節調整航班編號，因此不能只看單一來源。
3. **改抓特定日期頁面**以確認 11/17 排班（webfetch）：
   - `flightview.com`（date=2026-11-17）→ 頁面為 JS 渲染，無有效內容
   - `flightradar24.com` → 被 redirect policy 擋下（301）
4. **再抓兩筆特定日期來源**（webfetch，date=2026-11-17）：
   - `airnavradar.com` → 給出 11/17 當天資料：LAX（T1）→ ELP，07:30 PST 起飛、10:25 MST 抵達，Boeing 737-8（N8996Q），準時
   - `flightera.net` → 內容過少（顯示 Chicago to Oakland，與本檔日期無關）
5. **交叉驗證並定案**：以 `airnavradar.com` 的 11/17 排班為主，並用 `flight.info`（LAX T1 07:30 → ELP 10:25）交叉比對一致，故採用 LAX→ELP、07:30 PST / 10:25 MST。

**結論**：因航段會隨日期變動，最終鎖定「特定日期（11/17）」來源（AirNav Radar）＋另一來源（flight.info）交叉驗證後才定案。

---
*本檔由對話記錄逐字存檔。*


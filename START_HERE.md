# OODLE — 開始開發前先看這一頁

## 你現在在哪裡

Week 1 目標：做出可以用的首頁 + 寵物的家。

```
首頁（DrawScene）          寵物的家（RoomScene）
──────────────             ──────────────────
畫圖畫布          →  按  →  像素房間
ONNX 即時反饋     MAKE IT  寵物走動眨眼
12 色塊           LIVE ！  FEED/PLAY/SLEEP
底部寵物遊行               狀態條 + DAY 計數
```

---

## 第一次開 Claude Code 怎麼做

**1. 開 terminal，建立專案：**
```bash
npm create vite@latest oodle -- --template react-ts
cd oodle
npm install
npm install zustand @supabase/supabase-js onnxruntime-web
npm install -D @types/node
```

**2. 把 CLAUDE.md 複製到 oodle/ 根目錄。**

**3. 在 oodle/ 目錄裡執行 `claude`，開始 Claude Code session。**

**4. 第一句話：**
```
請讀取 CLAUDE.md，然後告訴我你理解了什麼，
確認後我們開始 Step 1。
```

**5. 確認 Claude Code 理解正確後，
   從 PROMPTS_WEEK1.md 複製 STEP 1 的內容貼進去。**

**6. 等它做完，`npm run dev` 看效果，確認沒問題。**

**7. 繼續貼 STEP 2，以此類推。**

---

## 每個 Step 完成後要檢查什麼

| Step | 檢查點 |
|---|---|
| Step 1 | 頁面背景是奶油色，字體是像素字 |
| Step 2 | PixelButton 渲染正確，按下有平移效果 |
| Step 3 | 畫布可以畫圖，格子對齊，Undo 有效 |
| Step 4 | 每筆畫後背景顏色輕微變化（即使沒有真實模型） |
| Step 5 | 後端 /api/recognize 端點存在，能回傳預設座標 |
| Step 6 | 小 canvas 上有動畫（浮動 + 眨眼） |
| Step 7 | 首頁完整，MAKE IT LIVE 有特效，展開房間 |
| Step 8 | StatBar 有刻度線，低狀態有閃爍 |
| Step 9 | 房間場景完整，行動按鈕有反饋，狀態存 localStorage |

---

## 出錯時怎麼辦

**報 TypeScript 錯誤：**
```
這個 TypeScript 錯誤怎麼修：
[貼完整 error message]
```

**效果不對：**
```
XXXXX 功能的預期效果是：[描述]
實際效果是：[描述]
請找出問題並修正，不要改其他正常的部分。
```

**不確定某個設計決策：**
```
先告訴我你的計劃，不要改任何檔案，
等我確認後再動手。
```

---

## 環境變數（.env）

在 oodle/ 根目錄建立 .env 檔案：
```
VITE_SUPABASE_URL=你的_supabase_url
VITE_SUPABASE_ANON_KEY=你的_supabase_anon_key
ANTHROPIC_API_KEY=你的_anthropic_api_key
```

.env 加入 .gitignore，不要 commit。

---

## 這週不需要做的事

- ❌ 不需要 Supabase（Week 1 全用 localStorage）
- ❌ 不需要用戶登入
- ❌ 不需要廣場
- ❌ 不需要桌面寵物
- ❌ 不需要真實 ONNX 模型（預設通過即可）

這週只需要：**畫圖 → 活起來 → 住進小家 → 每天照顧**

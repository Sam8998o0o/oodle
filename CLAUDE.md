# OODLE — Claude Code 指令手冊

> 每次開啟新 session，先讀完這份文件再動手。

---

## 一句話描述

像 drawafish.com 一樣極簡的首頁：用戶畫一隻 8-bit 像素寵物（64×64 格） →
像素分析驗證是否像物體 → 按 MAKE IT LIFE → 選眼睛款式 → 寵物動起來住進自己的像素小家。

---

## 技術棧（不得更改）

| 層級 | 技術 |
|---|---|
| 前端 | React 18 + Vite + TypeScript |
| 樣式 | CSS Modules（禁止用 Tailwind） |
| 畫布 | 純 HTML5 Canvas 2D |
| AI 驗證 | 純像素分析（64×64 格子資料） |
| AI 識別/生成 | Google Gemini 2.0 Flash |
| 狀態管理 | Zustand |
| 後端 | Node.js + Express（port 3001） |
| 資料庫 | Supabase（PostgreSQL + Realtime） |
| 認證 | Supabase Anonymous Auth + Google OAuth |
| 付費 | Stripe（月費訂閱） |
| 桌面 | Electron 28（待做） |

---

## 專案結構（當前實際狀態）

```
oodle/
├── CLAUDE.md
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── .env
│     VITE_SUPABASE_URL=
│     VITE_SUPABASE_ANON_KEY=
│     GEMINI_API_KEY=
│     STRIPE_SECRET_KEY=
│     STRIPE_WEBHOOK_SECRET=
│     STRIPE_PRICE_ID=
│     CLIENT_URL=http://localhost:5173
├── public/
│   ├── room-bg.png                   ← 已替換為正式背景
│   └── plaza-bg.png                  ← 待換
├── server/
│   ├── index.ts                      ← Express 入口
│   └── routes/
│       ├── generate-pet.ts           ← POST /api/generate-pet（Gemini）
│       └── stripe.ts                 ← POST /api/create-checkout-session
│                                        POST /api/create-portal-session
│                                        POST /api/webhook/stripe
├── src/
│   ├── main.tsx
│   ├── App.tsx                       ← 頂層：scene 管理 + isPremium + petAge
│   ├── styles/
│   │   └── tokens.css                ← 像素風全域變數 + 全域 button 樣式
│   ├── engine/
│   │   ├── PetAnimator.ts            ← 整數幀計數，step-based 像素動畫
│   │   ├── drawEye.ts                ← 獨立眼睛渲染（純 fillRect 點陣）
│   │   └── OnnxValidator.ts          ← 純像素分析（64×64 格子輸入）
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── auth.ts                   ← initAuth / linkGoogle / signOut
│   │   ├── stripe.ts                 ← createCheckoutSession / createPortalSession
│   │   ├── petService.ts             ← 所有 Supabase 操作（見下方列表）
│   │   └── realtimeService.ts
│   ├── scenes/
│   │   ├── DrawScene.tsx             ← 64×64 像素格畫布，接收 isPremium prop
│   │   ├── DrawScene.module.css
│   │   ├── RoomScene.tsx             ← 寵物的家，接收 isPremium prop
│   │   ├── RoomScene.module.css
│   │   ├── PlazaScene.tsx            ← 廣場，接收 isPremium prop
│   │   ├── PlazaScene.module.css
│   │   ├── PaywallScene.tsx          ← 付費牆（14 天到期 / 進階功能鎖定）
│   │   └── PaywallScene.module.css
│   ├── components/
│   │   ├── AuthButton.tsx
│   │   └── AuthButton.module.css
│   ├── ui/
│   │   ├── PixelCanvas.tsx
│   │   ├── PixelCanvas.module.css
│   │   └── StatBar.tsx
│   └── api/
│       └── aiRecognize.ts
└── supabase/
    └── schema.sql
```

---

## 視覺規範（必須遵守）

### 像素風色板（DrawScene 以外的場景）
```css
--color-bg:           #1a1a2e;
--color-surface:      #16213e;
--color-panel:        #0f3460;
--color-border:       #e94560;
--color-text:         #eaeaea;
--color-text-dim:     #888;
--color-cta:          #f5a623;
--color-danger:       #e94560;
--color-pixel-green:  #4ecca3;
--shadow-pixel:       4px 4px 0 #000;
--shadow-pixel-sm:    2px 2px 0 #000;
```

### DrawScene 專用（保持原版米黃風格）
```css
background: #FDF6E3
border: 2px solid #2C2C2C
box-shadow: 4px 4px 0 #2C2C2C
CTA: #FFE600
```

### PaywallScene 也用 DrawScene 風格（米黃）

### 字體
```
Press Start 2P — 所有遊戲 UI
VT323          — 對話泡泡、提示文字
```

### 像素 UI 規則
- `border-radius: 0`（全專案，無例外）
- 陰影：純偏移，無模糊
- 禁止 CSS transition 做遊戲動畫
- 禁止平滑繪圖（arc、bezier）

---

## 已完成功能 ✅

### App.tsx
- localStorage 持久化 petData（關閉瀏覽器回來繼續養同一隻寵物）
- isPremium state（從 checkSubscription() 載入）
- petAge state（從 getPetAge() 載入，用 Supabase created_at 計算）
- 免費用戶 petAge >= 14 → scene = 'paywall'
- Stripe 付費成功回調（?subscribed=true）
- isPremium 傳給所有子元件

### DrawScene（64×64 像素畫布）
- 64×64 格子畫布，每格 8px → 512×512px
- 工具：PEN / DEL / FILL，筆刷 1×/2×/4×
- 16 色色板，Undo 20 步，Grid toggle
- 像素驗證（score >= 0.6 通過）
- 裝飾步驟：眼睛選擇 + 拖放 + 命名
- isPremium = false → eye_star/heart/x 鎖定
- isPremium = true → 全部眼睛解鎖
- AI Generate tab：
  - isPremium = false → 顯示鎖定 + SUBSCRIBE TO UNLOCK 按鈕
  - isPremium = true → Gemini 生成 64×64 像素圖，可繼續編輯，自動通過驗證

### RoomScene（寵物的家）
- 背景：room-bg.png（已替換）
- 像素風寵物動畫（整數位移）
- 狀態條（hunger/happy/energy），每 30 秒衰減
- **離線衰減**：記錄 oodle_last_seen，回來時一次性計算補扣
- **暈倒系統**：hunger = 0 → sad state，停止走動，顯示「FEED ME! 😵」，餵食後恢復
- 自動睡眠（energy < 25）
- 晝夜系統
- DAY 計數器
- **Like 換食物**：5 ❤️ → 🍎 / 20 ❤️ → 🍱
- FEED 按鈕（日限 5 次）
- **捏寵物**：點擊抓癢（happy+10），長按拖拉丟出，重力彈跳反彈
- **暈眩 15 秒**：丟 2 次後，dizzy state，眼睛 X X，頭上 💫
- Room → Plaza 門動畫
- isPremium → 顯示 MANAGE PLAN 按鈕

### PlazaScene（廣場）
- 背景：plaza-bg.png（待換）
- Supabase 即時同步 + localStorage fallback
- 寵物 X+Y 雙向走動
- **發聲泡泡**：isPremium = false → 每天 10 次，isPremium = true → 每天 30 次
- **Like 系統**：每天只能給 10 隻不同寵物 like，每隻寵物一天只能 like 一次
- **像素心形 Like 動畫**（SVG fillRect 點陣）
- Plaza → Room 返回門動畫

### PaywallScene（付費牆）
- 顯示條件：免費用戶 petAge >= 14 天
- 寵物預覽（靜止）
- 好處列表：Keep pet forever / AI Generate / All eyes / 30 shouts/day
- 價格：$4.99/month
- SUBSCRIBE NOW 按鈕（未登入 → Google OAuth → Stripe，已登入 → 直接 Stripe）
- Already subscribed? Restore 連結

### 認證系統
- Supabase Anonymous Auth（自動靜默）
- Google OAuth 升級（匿名 → 正式帳號，資料保留）

### 付費系統（Stripe）
- 月費訂閱 $4.99/month
- Stripe Checkout（跳轉付費頁）
- Stripe Billing Portal（管理訂閱）
- Webhook 處理：checkout.session.completed / invoice.paid / subscription.updated / subscription.deleted

---

## 免費 vs 付費功能對比

| 功能 | 免費 | 付費 |
|---|---|---|
| 養寵物 | 14 天 | 無限期（按月） |
| 手畫寵物 | ✅ | ✅ |
| AI Generate | ❌ | ✅ |
| 基本眼睛（Round/Happy/Sleepy） | ✅ | ✅ |
| 付費眼睛（Star/Heart/X） | ❌ | ✅ |
| 每日 Shout 次數 | 10 次 | 30 次 |
| 廣場 Like | ✅（每天 10 個） | ✅（每天 30 個） |
| Like 換食物 | ✅ | ✅ |

---

## petService.ts 函數列表

```typescript
savePet()                    // 存寵物到 Supabase（idempotent）
fetchAllPets()               // 取所有寵物
getAllLikeCounts()            // 取所有寵物 like 數
likePet(petId)               // 給寵物 like
countTodayLikes()            // 今天給了幾個 like
getTodayLikedPetIds()        // 今天 liked 的 pet id Set
postShout(petId, message)    // 發聲
getActiveShouts()            // 取過去 20 秒的 shout
countTodayShouts()           // 今天發了幾次聲
likeShout(shoutId)           // like 一條 shout
getLikeBalance()             // 取 like 餘額
redeemLikesForFood(cost)     // 換食物（5 or 20）
checkSubscription()          // 檢查是否有有效訂閱
getPetAge()                  // 取寵物從 created_at 到現在的天數
```

---

## PetAnimator 狀態

```typescript
export type PetState = 'idle' | 'walk' | 'eat' | 'play' | 'sleep' | 'sad' | 'squish' | 'dizzy'
```

| State | 觸發 |
|---|---|
| idle | 預設 |
| walk | 自動 |
| eat | FEED |
| sleep | energy<25 或夜間 |
| sad | hunger=0（暈倒） |
| squish | 點擊/落地 |
| dizzy | 丟 2 次後停下，15 秒 |

---

## 常數

```typescript
// 畫布
GRID_SIZE = 64 / CELL_SIZE = 8 / CANVAS_PX = 512

// Like 換食物
SMALL_HUNGER = 10 / BIG_HUNGER = 20 / DAILY_EAT_LIMIT = 5

// 離線衰減
IDLE_DECAY_RATE: hunger -1/30s, happy -0.5/30s, energy -0.8/30s
LAST_SEEN_KEY = 'oodle_last_seen'

// 發聲
SHOUT_DAILY_LIMIT = isPremium ? 30 : 10
SHOUT_DURATION_MS = 15000

// 付費
FREE_TRIAL_DAYS = 14
SUBSCRIPTION_PRICE = '$4.99/month'
```

---

## 資料庫 Schema

```sql
-- pets：user_id + created_at（用 Supabase 伺服器時間算 petAge）
-- likes：UNIQUE(pet_id, user_id)，有 created_at 欄位（日限查詢用）
-- shouts：message 限 30 字
-- shout_likes：UNIQUE(shout_id, user_id)
-- like_balance：每用戶累積餘額
-- subscriptions：user_id UNIQUE，status/period/stripe_ids
-- Functions: like_shout / redeem_likes / check_subscription / upsert_subscription
-- Realtime: pets + shouts
```

---

## 後端 API

```
POST /api/generate-pet
  body:  { prompt: string }
  回傳:  { image: dataURL }
  model: gemini-2.0-flash-preview-image-generation

POST /api/create-checkout-session
  body:  { userId: string }
  回傳:  { url: string }

POST /api/create-portal-session
  body:  { userId: string }
  回傳:  { url: string }

POST /api/webhook/stripe
  header: stripe-signature
  處理: checkout.session.completed / invoice.paid /
        customer.subscription.updated / customer.subscription.deleted
```

---

## 下一步路線圖

### 待做
- [ ] 替換 plaza-bg.png 像素風背景圖
- [ ] Vercel + Railway 部署上線
- [ ] Push Notification（寵物餓了通知）
- [ ] Electron 桌面寵物
- [ ] 道具商店（更多付費道具）

### 已完成 ✅
- 像素風全面改造（畫布、UI、動畫）
- 64×64 格子畫布 + drawEye.ts
- localStorage 寵物持久化
- 離線衰減系統
- 暈倒系統（hunger=0）
- Like 每日限制（10 隻，每隻一次）
- 發聲泡泡系統
- 捏/丟/暈眩互動
- Room ↔ Plaza 門動畫
- Supabase 即時同步
- Stripe 月費訂閱系統
- PaywallScene（14 天免費到期）
- isPremium 解鎖：AI Generate / 付費眼睛 / 30 shouts

---

## 禁止事項

- 禁止用 `any` 型別
- 禁止在 React 元件裡寫動畫邏輯（全部在 `engine/`）
- 禁止在 `useEffect` 依賴陣列裡放 object 直接比較
- 禁止在動畫 loop 裡呼叫 `setState`
- 禁止用 `alert()` / `confirm()`
- 禁止用 CSS `transition` 做遊戲動畫
- 禁止用 `border-radius`（全專案，無例外）
- 禁止用平滑繪圖（arc、bezier）做像素風動畫
- 禁止強制登入（免費功能必須能在匿名狀態下完整玩）

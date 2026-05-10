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
| AI 識別/生成 | Google Gemini 2.0 Flash（眼睛座標 + 像素圖生成） |
| 狀態管理 | Zustand |
| 後端 | Node.js + Express（port 3001） |
| 資料庫 | Supabase（PostgreSQL + Realtime） |
| 認證 | Supabase Anonymous Auth（自動靜默，不需註冊） |
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
├── .env                              ← VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / GEMINI_API_KEY
├── public/
│   ├── room-bg.png                   ← 待換（目前純色 placeholder）
│   └── plaza-bg.png                  ← 待換（目前純色 placeholder）
├── server/
│   ├── index.ts                      ← Express 入口，掛載 /api/generate-pet
│   └── routes/
│       └── generate-pet.ts           ← POST /api/generate-pet（Gemini 2.0 Flash）
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── styles/
│   │   └── tokens.css                ← 像素風全域變數 + 全域 button 樣式
│   ├── engine/
│   │   ├── PetAnimator.ts            ← 整數幀計數，step-based 像素動畫
│   │   ├── drawEye.ts                ← 獨立眼睛渲染（純 fillRect 點陣）
│   │   └── OnnxValidator.ts          ← 純像素分析（64×64 格子輸入）
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── auth.ts
│   │   ├── petService.ts             ← savePet / fetchAllPets / likePet / getAllLikeCounts
│   │   │                                postShout / getActiveShouts / countTodayShouts
│   │   │                                likeShout / getLikeBalance / redeemLikesForFood
│   │   └── realtimeService.ts
│   ├── scenes/
│   │   ├── DrawScene.tsx             ← 64×64 像素格畫布 + 垂直 sidebar + AI 生成
│   │   ├── DrawScene.module.css      ← editorArea / sidebar / mainArea 佈局
│   │   ├── RoomScene.tsx
│   │   ├── RoomScene.module.css      ← 純色背景 + 地板線 + 像素風門/按鈕
│   │   ├── PlazaScene.tsx            ← PixelHeart like 動畫 + 發聲泡泡
│   │   └── PlazaScene.module.css     ← 純色背景 + 地板線 + pixelHeart
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

### 像素風色板
```css
--color-bg:           #1a1a2e;
--color-surface:      #16213e;
--color-panel:        #0f3460;
--color-border:       #e94560;
--color-text:         #eaeaea;
--color-text-dim:     #888;
--color-cta:          #f5a623;
--color-danger:       #e94560;
--color-hunger:       #f5a623;
--color-happy:        #e94560;
--color-energy:       #00b4d8;
--color-grid:         rgba(255,255,255,0.05);
--color-pixel-green:  #4ecca3;
--color-pixel-yellow: #f5a623;
--shadow-pixel:       4px 4px 0 #000;
--shadow-pixel-sm:    2px 2px 0 #000;
```

### 字體
```
Press Start 2P — 所有遊戲 UI：標題、按鈕、標籤、DAY 計數
VT323          — 對話泡泡、提示文字、次要說明
```

### 像素 UI 規則
- 所有邊框：`2px solid var(--color-border)`，`border-radius: 0`（強制，全專案禁止）
- 所有陰影：`var(--shadow-pixel)`（4px 4px 0 #000，無模糊）
- 按鈕按下：`transform: translate(2px, 2px)` + `box-shadow: var(--shadow-pixel-sm)`
- 全域 `button {}` 已在 tokens.css 定義
- 禁止用 `transition`，動畫用 `steps()` keyframes
- 禁止平滑繪圖（arc、bezier），改用 fillRect + 整數位移

---

## 已完成功能 ✅

### tokens.css
- 深藍黑調色板 + `--shadow-pixel` / `--shadow-pixel-sm`
- 全域 `button {}` 基礎樣式（像素邊框、zero border-radius、active/disabled）

### drawEye.ts
- 純 `fillRect` 整數點陣，6 種眼睛款式
- blink = true → 水平線

### PetAnimator.ts
- 整數 `frameCount`，全部 step-based 動畫
- idle ±1px/30f、walk ±2px/8f、eat 點頭/8f、sleep 即時橫躺
- sad -1px/60f α0.7、squish 16f 壓扁、dizzy ±2px/6f eye_x 💫

### DrawScene.tsx + DrawScene.module.css
- 64×64 格子畫布（`string[][]`），每格 8px → 512×512px
- 垂直 `.sidebar`（PEN / DEL / FILL + 1PX/2PX/4PX + ↩/CLR）
- `.editorArea`（flex row）= sidebar + `.mainArea`（canvas + palette）
- 色板：8列×2行，每格 16×16px，selected 加白框
- Undo 20 步 / Clear / 網格 overlay
- 裝飾步驟：像素預覽 + 可拖放眼睛
- AI Generate tab：「COMING SOON」鎖定

### RoomScene.module.css
- `background: #1a1a2e`，`::after` 地板線
- `.doorLeft` / `.doorRight`：`background: #4a3728`（深木色），`::after` 把手無 border-radius
- `.doorTop`：`var(--color-surface)` bg / `var(--color-text)` text / `var(--color-border)` border
- `.actionBar`：`var(--color-surface)` bg，`var(--color-border)` border-top
- `.actionBtn`：`var(--color-panel)` bg，token border + shadow
- `.plazaBtn`：`var(--color-cta)` bg，`color: #000`

### PlazaScene.module.css
- `background: #0f3460`，`::after` 地板線
- `.pixelHeart` + `@keyframes pixelHeartFloat`

### PlazaScene.tsx
- `PixelHeart` 元件（SVG `<rect>` 11×9 點陣，#e94560）
- `handleLike` 在按鈕位置生成 PixelHeart，1.4s 後移除

### server/routes/generate-pet.ts
- `POST /api/generate-pet`
- 使用 `gemini-2.0-flash-preview-image-generation`
- 回傳 `{ image: dataURL }`（64×64 PNG base64）

### server/index.ts
- `/api/generate-pet` 路由掛載完成

---

## 功能系統（邏輯不變，已完整）

### RoomScene.tsx
- Like 換食物（5 ❤️ → 🍎 / 20 ❤️ → 🍱）
- FEED（小 +10 / 大 +20 飢餓），日限 5 次
- 捏寵物點擊 + 長按拖拉丟出 + 重力彈跳
- 暈眩 15 秒（dizzy：eye_x + 💫，不動）
- Room → Plaza 門動畫（appearing → opening → walking → done）
- 晝夜系統、離線衰減、DAY 計數

### PlazaScene.tsx
- Supabase 即時同步 + localStorage fallback
- 發聲泡泡（每天 10 次，15 秒，像素方形勾腳）
- Plaza → Room 返回門動畫
- Like 累積 → like_balance → 回 Room 換食物

---

## PetAnimator 狀態

```typescript
export type PetState = 'idle' | 'walk' | 'eat' | 'play' | 'sleep' | 'sad' | 'squish' | 'dizzy'
```

| State | 動畫 | 眼睛 | 觸發 |
|---|---|---|---|
| idle | ±1px/30f | 正常 | 預設 |
| walk | ±2px/8f 左右 | 正常 | 自動 |
| eat | 點頭/8f | 正常 | FEED |
| sleep | 即時橫躺 | 閉眼 | energy<25 |
| sad | -1px/60f α0.7 | 半閉 | hunger=0 |
| squish | 16f 壓扁 | 正常 | 點擊/落地 |
| dizzy | ±2px/6f 💫 15s | X X | 丟 2 次後停下 |

---

## OnnxValidator 規範

```typescript
// 輸入：64×64 格子資料（傳入 64×64 canvas）
// hasArea    非空格 / 4096 >= 0.04
// hasFill    bounding box 填色密度 >= 0.35
// hasShape   短邊/長邊 >= 0.25
// score >= 0.6 → 通過
// AI 生成寵物跳過此驗證
```

---

## 常數一覽

```typescript
// 畫布
GRID_SIZE     = 64    // 格子數
CELL_SIZE     = 8     // 每格 px
CANVAS_PIXELS = 512   // 顯示大小

// Like 換食物
SMALL_HUNGER    = 10
BIG_HUNGER      = 20
DAILY_EAT_LIMIT = 5
IDLE_HOURS      = 8
IDLE_DECAY      = 10

// 發聲
SHOUT_DAILY_LIMIT = 10
SHOUT_DURATION_MS = 15000

// 廣場走路
LEFT_BOUND = 80
RIGHT_PAD  = 80
WALK_Y_MIN = 0.68
WALK_Y_MAX = 0.88
```

---

## 資料庫 Schema

```sql
-- pets、likes（現有）
-- shouts：message CHECK length BETWEEN 1 AND 30
-- shout_likes：UNIQUE(shout_id, user_id)
-- like_balance：每用戶累積餘額，SECURITY DEFINER 管理
-- Functions: like_shout / redeem_likes
-- Realtime: pets + shouts
```

---

## 後端 API

```
POST /api/generate-pet
  body:  { prompt: string }
  回傳:  { image: dataURL }     ← 64×64 PNG base64
  model: gemini-2.0-flash-preview-image-generation
  前端目前鎖定 Coming Soon（isPremium = false）
```

---

## 下一步路線圖

### 待做
- [ ] 提供並替換 Room / Plaza 像素風背景圖
- [ ] 付費啟用 AI 生成（isPremium → Stripe 或其他）
- [ ] 道具商店（付費眼睛款式解鎖）
- [ ] Vercel + Railway 部署上線
- [ ] Push Notification（寵物餓了通知）
- [ ] Electron 桌面寵物（全局鍵盤 / 桌面懸浮）

### 已完成 ✅
- tokens.css 像素風深色調色板 + 全域 button
- drawEye.ts（純 fillRect 6 種眼睛）
- PetAnimator.ts（整數 step-based 全部動畫）
- DrawScene 完全重寫（64×64 格子 + 垂直 sidebar）
- DrawScene.module.css 深色像素風佈局
- RoomScene.module.css 像素風門/按鈕/地板線
- PlazaScene.module.css 純色背景 + pixelHeart
- PlazaScene.tsx PixelHeart SVG 點陣 like 動畫
- server/routes/generate-pet.ts（Gemini 生成端點）
- Like 換食物系統
- 發聲泡泡系統（每天 10 次）
- 捏/丟/暈眩互動系統
- Room ↔ Plaza 門動畫
- Supabase 即時同步 + Realtime

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
- 禁止強制登入（遊戲必須能在匿名狀態下完整玩）

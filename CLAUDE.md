# OODLE — Claude Code 指令手冊

> 每次開啟新 session，先讀完這份文件再動手。

---

## 一句話描述

像 drawafish.com 一樣極簡的首頁：用戶畫一隻像素寵物 → 像素分析即時驗證是否像物體 →
按 MAKE IT LIFE → 選眼睛款式 → 寵物動起來住進自己的小家。

---

## 技術棧（不得更改）

| 層級 | 技術 |
|---|---|
| 前端 | React 18 + Vite + TypeScript |
| 樣式 | CSS Modules（禁止用 Tailwind） |
| 畫布 | 純 HTML5 Canvas 2D |
| AI 驗證 | 純像素分析（Canvas pixel analysis，免費即時，無需模型） |
| AI 識別 | Google Gemini 2.0 Flash（識別眼睛座標） |
| 狀態管理 | Zustand |
| 後端 | Node.js + Express（port 3001） |
| 資料庫 | Supabase（PostgreSQL + Realtime） |
| 認證 | Supabase Anonymous Auth（自動靜默，不需註冊） |
| 桌面 | Electron 28（Week 3-4，待做） |

---

## 專案結構（當前實際狀態）

```
oodle/
├── CLAUDE.md
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── .env                              ← VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
├── public/
│   ├── room-bg.png                   ← South Park 風格臥室背景
│   └── plaza-bg.png                  ← South Park 風格城市廣場背景
├── src/
│   ├── main.tsx
│   ├── App.tsx                       ← 頂層，initAuth() + <AuthButton />
│   ├── styles/
│   │   └── tokens.css
│   ├── engine/
│   │   ├── PetAnimator.ts
│   │   └── OnnxValidator.ts          ← 純像素分析，不需要 .onnx 模型檔案
│   ├── lib/                          ← Supabase 相關
│   │   ├── supabase.ts               ← createClient singleton
│   │   ├── auth.ts                   ← initAuth / linkGoogle / signOut
│   │   ├── petService.ts             ← savePet / fetchAllPets / likePet / getAllLikeCounts
│   │   └── realtimeService.ts        ← subscribeToNewPets
│   ├── scenes/
│   │   ├── DrawScene.tsx             ← 畫圖 + 像素驗證 + 眼睛裝飾
│   │   ├── DrawScene.module.css
│   │   ├── RoomScene.tsx             ← 寵物的家 + 能量系統 + 門過場動畫
│   │   ├── RoomScene.module.css
│   │   ├── PlazaScene.tsx            ← 廣場 + Supabase 即時同步 + 障礙物避開
│   │   └── PlazaScene.module.css
│   ├── components/
│   │   ├── AuthButton.tsx            ← 匿名/Google 登入按鈕（左下角，不顯眼）
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

### 顏色
```css
--color-bg:        #FDF6E3;
--color-canvas:    #FFFFFF;
--color-text:      #2C2C2C;
--color-border:    #2C2C2C;
--color-cta:       #FFE600;
--color-danger:    #FF5A5F;
--color-hunger:    #F5A623;
--color-happy:     #E8534A;
--color-energy:    #2196F3;
--color-grid:      rgba(0,0,0,0.05);
```

### 字體（Google Fonts）
```
Press Start 2P — 所有遊戲 UI：標題、按鈕、標籤、DAY 計數
VT323          — 對話泡泡、提示文字、次要說明
```

### 像素 UI 規則
- 所有邊框：`2–3px solid var(--color-border)`，`border-radius: 0`
- 所有陰影：`box-shadow: 4px 4px 0 var(--color-border)`
- 按鈕按下：`transform: translate(2px, 2px)` + `box-shadow: 2px 2px 0`
- 禁止用 `transition`，動畫用 `steps()` keyframes
- 禁止用 `border-radius`（除非特別說明）

---

## 已完成功能 ✅

### DrawScene（首頁）
- 自由畫布（400px，圓形筆刷，流暢線條）
- 12 色板 + 筆刷大小滑桿
- Draw / Erase / Fill / Undo / Clear 工具
- **像素分析驗證**（coverage + colorFill + enclosure，分數 >= 0.6 才能進下一步）
- 按 MAKE IT LIFE 進入裝飾步驟
- 粒子特效
- 底部寵物遊行已移除

### 裝飾步驟（DrawScene decorate）
- 選眼睛款式（6 種：Round / Happy / Sleepy 免費，Star / Heart / X 付費鎖定）
- 拖放眼睛位置
- 預覽動畫（呼吸 + 眨眼）
- 命名（最多 16 字）
- BRING IT TO LIFE 確認

### RoomScene（寵物的家）
- South Park 風格臥室背景（room-bg.png）
- 寵物走路動畫
- 自動睡眠（energy < 25）
- 狀態條（飢餓 / 心情 / 體力），每 30 秒自動下降
- DAY 計數器
- **能量系統**：打字 100 下 = 1 點能量，手動轉化成小果實（5 點）/ 大果實（30 點）
- **食物背包**：小果實上限 10 / 大果實上限 5，存房間內
- **FEED 按鈕**：消耗背包果實（小 +10 飢餓 / 大 +20），一天上限 5 次
- **離線衰減**：超過 8 小時沒打字，每小時飢餓 -10
- **週末模式**：衰減減半，寵物偶爾跳 play 慶祝
- **晝夜系統**：晚上 22:00–06:00 背景變暗，自動睡眠
- **Room → Plaza 開門過場動畫**（門板展開 → 寵物走向門口消失）
- savePet() 存 Supabase

### PlazaScene（廣場）
- South Park 城市廣場背景（plaza-bg.png）
- **Supabase 即時同步**：所有用戶寵物即時出現，localStorage fallback
- **Realtime**：subscribeToNewPets，新寵物加入自動更新
- 寵物在廣場隨機 Y 位置自由走動
- **障礙物避開**：7 個 OBSTACLE_ZONES（椅子、路燈、垃圾桶），碰到反向
- **自己寵物閃光**：進廣場後閃黃色光暈 8 秒
- 點擊寵物彈出資訊卡（名字 / 加入日期 / ❤️ likes）
- Like 功能（Supabase + localStorage）
- **晝夜系統**：夜間遮罩 + 月亮星星
- ← MY ROOM 返回按鈕

### 認證系統
- Supabase Anonymous Auth（自動靜默，不需註冊）
- AuthButton（左下角，匿名顯示「SIGN IN TO SAVE」，登入後顯示帳號）
- Google OAuth 升級（匿名 → 正式帳號，資料保留）

---

## OnnxValidator 規範（現為純像素分析）

```typescript
// src/engine/OnnxValidator.ts
// 不需要任何模型檔案，純 Canvas pixel analysis
// 三個條件加權：
//   coverage   0.25 — 畫了多少面積
//   colorFill  0.50 — 有沒有上色（非白非透明）
//   enclosure  0.25 — 輪廓是否封閉（flood fill 測試）
// score >= 0.6 → creature（通過）
// score >= 0.3 → maybe
// score <  0.3 → unknown（拒絕）
```

---

## 能量系統常數（RoomScene）

```typescript
const KEYS_PER_ENERGY  = 100   // 100 下按鍵 = 1 點能量
const ENERGY_FOR_SMALL = 5     // 小果實成本
const ENERGY_FOR_BIG   = 30    // 大果實成本
const SMALL_MAX        = 10    // 背包小果實上限
const BIG_MAX          = 5     // 背包大果實上限
const SMALL_HUNGER     = 10    // 小果實補飢餓
const BIG_HUNGER       = 20    // 大果實補飢餓
const DAILY_EAT_LIMIT  = 5     // 一天最多吃幾次
const IDLE_HOURS       = 8     // 幾小時沒打字開始衰減
const IDLE_DECAY       = 10    // 每小時扣飢餓
```

---

## 廣場走路規範（PlazaScene）

```typescript
const LEFT_BOUND  = 80         // 左邊界
const RIGHT_PAD   = 80         // 右邊距
const WALK_Y_MIN  = 0.80       // walkway 上邊界（room 高度 %）
const WALK_Y_MAX  = 0.88       // walkway 下邊界
// 出生點：Math.random() 全寬隨機，不用 lane 系統
// 走路：碰到障礙物或邊界就反向
```

---

## 資料庫 Schema（當前）

```sql
-- supabase/schema.sql
-- pets 表：user_id 綁定 Supabase Auth（包括匿名用戶）
-- likes 表：UNIQUE(pet_id, user_id) 防止重複 like
-- RLS：任何登入用戶（包括匿名）可讀寫
-- Realtime 已開啟 pets 表
```

---

## 型別規範

```typescript
export interface PetStats {
  hunger:  number;  // 0–100
  happy:   number;  // 0–100
  energy:  number;  // 0–100
}

export interface PetCoords {
  eyes:     { x: number; y: number }[];
  legs:     { x: number; y: number }[];
  center:   { x: number; y: number };
  has_eyes: boolean;
  has_legs: boolean;
}
```

---

## 下一步路線圖

### Week 3-4（待做）
- [ ] Vercel + Railway 部署上線
- [ ] 道具商店（付費眼睛款式解鎖）
- [ ] Electron 桌面寵物（全局鍵盤監聽，跨 App 累積能量）

### 已知問題
- 廣場 Y 位置需根據實際畫面微調 WALK_Y_MIN / WALK_Y_MAX
- 障礙物座標為估算值，可能需要根據實際背景圖微調

---

## 禁止事項

- 禁止用 `any` 型別
- 禁止在 React 元件裡寫動畫邏輯（全部在 `engine/`）
- 禁止在 `useEffect` 依賴陣列裡放 object 直接比較
- 禁止在動畫 loop 裡呼叫 `setState`
- 禁止用 `alert()` / `confirm()`
- 禁止用 CSS `transition` 做遊戲動畫
- 禁止用 `border-radius`
- 禁止強制登入（遊戲必須能在匿名狀態下完整玩）

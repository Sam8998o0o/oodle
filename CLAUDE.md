# OODLE — Claude Code 指令手冊

> 每次開啟新 session，先讀完這份文件再動手。

---

## 一句話描述

像 drawafish.com 一樣極簡的首頁：用戶畫一隻像素寵物 → ONNX 即時驗證是否像生物 →
按 MAKE IT LIVE → Claude Vision 識別眼睛/腿座標 → 寵物動起來住進自己的小家。

---

## 技術棧（不得更改）

| 層級 | 技術 |
|---|---|
| 前端 | React 18 + Vite + TypeScript |
| 樣式 | CSS Modules（禁止用 Tailwind） |
| 畫布 | 純 HTML5 Canvas 2D |
| AI 驗證 | ONNX Runtime Web（瀏覽器內，免費即時） |
| AI 識別 | Anthropic Claude Vision API（後端，一次性） |
| 狀態管理 | Zustand |
| 後端 | Node.js + Express |
| 資料庫 | Supabase（PostgreSQL） |
| 桌面 | Electron 28（後期） |

---

## 專案結構（必須遵守）

```
oodle/
├── CLAUDE.md
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── public/
│   └── models/
│       └── pet_validator.onnx        ← ONNX 模型放這裡
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── styles/
│   │   └── tokens.css                ← 所有 CSS 變數
│   ├── engine/                       ← 動畫引擎（純 TS，無 React）
│   │   ├── PetAnimator.ts
│   │   ├── PixelRenderer.ts
│   │   └── OnnxValidator.ts
│   ├── pets/
│   │   ├── petTypes.ts
│   │   ├── petStore.ts
│   │   └── petUtils.ts
│   ├── scenes/
│   │   ├── DrawScene.tsx             ← 首頁（畫圖 + MAKE IT LIVE）
│   │   ├── DrawScene.module.css
│   │   ├── RoomScene.tsx             ← 寵物的家
│   │   ├── RoomScene.module.css
│   │   ├── PlazaScene.tsx            ← 公共廣場
│   │   └── PlazaScene.module.css
│   ├── ui/
│   │   ├── PixelCanvas.tsx           ← 像素繪圖畫布元件
│   │   ├── PixelCanvas.module.css
│   │   ├── StatBar.tsx
│   │   ├── StatBar.module.css
│   │   ├── PixelButton.tsx
│   │   ├── PixelButton.module.css
│   │   └── SpeechBubble.tsx
│   └── api/
│       ├── supabase.ts
│       ├── petStorage.ts
│       ├── plazaApi.ts
│       └── aiRecognize.ts            ← Claude Vision API 呼叫
├── server/
│   ├── index.ts                      ← Express 後端
│   ├── routes/
│   │   ├── pets.ts
│   │   └── recognize.ts              ← Claude Vision 端點
│   └── supabase.ts
└── supabase/
    └── schema.sql
```

---

## 視覺規範（必須遵守）

### 顏色
```css
--color-bg:        #FDF6E3;   /* 溫暖奶油色頁面背景 */
--color-canvas:    #FFFFFF;   /* 畫布純白 */
--color-text:      #2C2C2C;   /* 近黑文字 */
--color-border:    #2C2C2C;   /* 像素邊框 */
--color-cta:       #FFE600;   /* MAKE IT LIVE 按鈕 */
--color-danger:    #FF5A5F;   /* 低狀態警告 */
--color-hunger:    #F5A623;   /* 飢餓條橙色 */
--color-happy:     #E8534A;   /* 心情條珊瑚 */
--color-energy:    #2196F3;   /* 體力條藍色 */
--color-grid:      rgba(0,0,0,0.05); /* 畫布格線 */
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

## 動畫引擎規範

- **所有動畫邏輯禁止在 React 元件裡** → 全部放 `src/engine/`
- 元件只負責：掛載 canvas ref、傳參數給 engine、處理 UI 事件
- `useEffect` 必須有 cleanup（`return () => animator.stop()`）
- 所有 canvas：`image-rendering: pixelated`，`ctx.imageSmoothingEnabled = false`
- 所有座標：`Math.round()` 取整，禁止小數像素
- 動畫驅動：**只用 `requestAnimationFrame`**，禁止 `setInterval`

### 關鍵動畫數值
```
眨眼週期：  3.5 ± 1.5 秒（每隻隨機偏移）
眨眼持續：  80–100ms
浮動幅度：  ±2px，sin 波，週期 2 秒
腿擺幅：    ±5px，左右反相
地面陰影：  橢圓，opacity 0.10–0.20
走路速度：  0.5px/frame（房間），0.4px/frame（廣場）
```

---

## ONNX 驗證規範

```typescript
// src/engine/OnnxValidator.ts
// 功能：在瀏覽器內即時跑模型，判斷畫的東西像不像生物
// 觸發：每次 mouseup（每筆畫結束後）
// 回傳：{ score: number, label: string }
// 反饋：score >= 0.6 → 畫布背景色漸變為淡綠，< 0.3 → 淡紅
// 模型路徑：/public/models/pet_validator.onnx
// 注意：模型檔案 MVP 階段用 MobileNetV2 替代，後期換自訓練模型
```

---

## Claude Vision API 規範

```typescript
// src/api/aiRecognize.ts
// 觸發：用戶按下 MAKE IT LIVE
// 只呼叫一次，結果存進 Supabase pets.ai_coords

interface PetCoords {
  eyes:      { x: number; y: number }[];   // 0.0–1.0 百分比座標
  legs:      { x: number; y: number }[];
  center:    { x: number; y: number };
  has_eyes:  boolean;
  has_legs:  boolean;
}

// 失敗時的預設值（fallback）
const DEFAULT_COORDS: PetCoords = {
  eyes:     [{ x: 0.35, y: 0.28 }, { x: 0.65, y: 0.28 }],
  legs:     [{ x: 0.25, y: 0.85 }, { x: 0.45, y: 0.85 },
             { x: 0.55, y: 0.85 }, { x: 0.75, y: 0.85 }],
  center:   { x: 0.5, y: 0.5 },
  has_eyes: false,
  has_legs: false,
};
```

---

## 資料庫 Schema

```sql
-- supabase/schema.sql

create table pets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users,
  name         text not null default 'My Pet',
  pixel_data   text not null,        -- base64 dataURL
  ai_coords    jsonb,                -- PetCoords JSON
  stats        jsonb default '{"hunger":80,"happy":80,"energy":80}',
  day_count    integer default 1,
  votes        integer default 0,
  last_fed_at  timestamptz default now(),
  created_at   timestamptz default now()
);

create table interactions (
  id           uuid primary key default gen_random_uuid(),
  from_pet_id  uuid references pets,
  to_pet_id    uuid references pets,
  type         text check (type in ('vote','pat','feed')),
  created_at   timestamptz default now()
);
```

---

## 首頁規範（DrawScene）

像 drawafish.com 一樣極簡，由上到下只有：

```
1. OODLE 大標題（Press Start 2P）
2. 副標語：draw a pet. make it live.
3. 240×240 像素畫布（白底，8px 格子，預載示例寵物）
4. 12 色塊顏色板
5. ERASE + CLEAR 工具按鈕
6. ▶ MAKE IT LIVE 按鈕（鮮黃，最搶眼）
7. 底部寵物遊行橫條（56px，所有寵物走動）
```

**禁止加入任何導航、說明、登入牆、教學彈窗。**

---

## 寵物的家規範（RoomScene）

- 按 MAKE IT LIVE 後，**不換頁**，在畫布下方滑順展開
- 像素室內場景（牆、木地板、窗、書架、盆栽）
- 三條狀態條 + 三個行動按鈕（FEED / PLAY / SLEEP）
- 右上角 DAY 計數器
- 所有狀態存 localStorage（MVP 不依賴後端）

---

## 型別規範

```typescript
// src/pets/petTypes.ts

export interface Pet {
  id:         string;
  name:       string;
  pixelData:  string;        // base64 dataURL
  aiCoords:   PetCoords;
  stats:      PetStats;
  dayCount:   number;
  votes:      number;
  lastFedAt:  Date;
  createdAt:  Date;
}

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

## 禁止事項

- 禁止用 `any` 型別（用 `unknown` + type guard）
- 禁止在 React 元件裡寫動畫邏輯（全部在 `engine/`）
- 禁止在 `useEffect` 依賴陣列裡放 object 直接比較
- 禁止在動畫 loop 裡呼叫 `setState`
- 禁止用 `alert()` / `confirm()`（做像素風格 modal）
- 禁止用 CSS `transition` 做遊戲動畫
- 禁止用 `border-radius`（像素風格）

---

## 開發順序（Week 1 目標）

```
Step 1 → src/styles/tokens.css          CSS 變數 + Google Fonts 載入
Step 2 → src/ui/PixelButton.tsx          可複用像素按鈕
Step 3 → src/ui/PixelCanvas.tsx          像素繪圖畫布（核心）
Step 4 → src/engine/OnnxValidator.ts     ONNX 即時驗證
Step 5 → src/api/aiRecognize.ts          Claude Vision API
Step 6 → src/engine/PetAnimator.ts       動畫引擎
Step 7 → src/scenes/DrawScene.tsx        首頁整合
Step 8 → src/ui/StatBar.tsx              狀態條元件
Step 9 → src/scenes/RoomScene.tsx        寵物的家
```

每完成一步，在瀏覽器確認效果正確，再繼續下一步。

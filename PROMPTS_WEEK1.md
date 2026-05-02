# OODLE — Claude Code 第一步完整 Prompt 手冊

把下面的 Prompt 一個一個複製貼進 Claude Code，
**每一步確認跑起來沒問題，才貼下一個。**

---

## 準備工作（貼進 terminal，不是 Claude Code）

```bash
# 1. 建立專案
npm create vite@latest oodle -- --template react-ts
cd oodle
npm install

# 2. 安裝依賴
npm install zustand @supabase/supabase-js onnxruntime-web
npm install -D @types/node

# 3. 把 CLAUDE.md 放進專案根目錄（已提供）

# 4. 啟動開發伺服器
npm run dev
```

---

## STEP 1 — CSS 設計系統

```
讀取 CLAUDE.md。

建立 src/styles/tokens.css，內容包含：

1. 載入 Google Fonts：Press Start 2P 和 VT323

2. :root 定義所有 CSS 變數：
   --color-bg: #FDF6E3
   --color-canvas: #FFFFFF
   --color-text: #2C2C2C
   --color-border: #2C2C2C
   --color-cta: #FFE600
   --color-danger: #FF5A5F
   --color-hunger: #F5A623
   --color-happy: #E8534A
   --color-energy: #2196F3
   --color-grid: rgba(0,0,0,0.05)
   --font-pixel: 'Press Start 2P', monospace
   --font-retro: 'VT323', monospace

3. body 基本樣式：
   background: var(--color-bg)
   color: var(--color-text)
   font-family: var(--font-pixel)
   margin: 0, padding: 0
   image-rendering: pixelated

4. 全域 * { box-sizing: border-box }

然後在 src/main.tsx 載入這個 CSS 檔案。
```

---

## STEP 2 — PixelButton 元件

```
讀取 CLAUDE.md。

建立 src/ui/PixelButton.tsx 和 src/ui/PixelButton.module.css。

這是整個遊戲通用的像素風格按鈕元件。

Props interface：
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary' | 'cta'
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'

樣式規格：
  字體：var(--font-pixel)
  邊框：2px solid var(--color-border)，border-radius: 0
  陰影：box-shadow: 3px 3px 0 var(--color-border)
  按下 :active：transform: translate(2px, 2px)，box-shadow: 1px 1px 0

variant 顏色：
  primary：background #fff，color var(--color-text)
  secondary：background #f0f0f0，color #666
  cta：background var(--color-cta)，color var(--color-text)，box-shadow 更大 5px 5px

size 字體大小：
  sm: 6px，padding: 6px 10px
  md: 8px，padding: 8px 14px（預設）
  lg: 10px，padding: 12px 20px

disabled：opacity 0.4，cursor: not-allowed，無按下效果

禁止用 border-radius，禁止用 transition。
```

---

## STEP 3 — PixelCanvas 元件（最重要）

```
讀取 CLAUDE.md。

建立 src/ui/PixelCanvas.tsx 和 src/ui/PixelCanvas.module.css。

功能規格：

1. 畫布尺寸：邏輯 240×240，每格 8px（30×30 格子）
   css width/height: 240px，image-rendering: pixelated

2. 格子網格線：
   每 8px 畫一條，顏色 var(--color-grid)
   lineWidth: 0.5

3. 工具支援：
   - pencil（預設）：左鍵拖拉畫點
   - eraser：塗白色
   - fill：flood fill 演算法（4方向遞歸/堆疊）

4. Undo：最多儲存 20 個 ImageData 快照
   每次 mousedown 前先 snapshot()

5. 顏色板：
   12 個預設色：
   ['#2C2C2C','#FF5A5F','#F5A623','#FFE600',
    '#4CAF50','#2196F3','#9C27B0','#FF9800',
    '#00BCD4','#E91E63','#8BC34A','#FFFFFF']
   選中狀態：border: 2px solid var(--color-border)

6. 預載示例寵物：
   元件 mount 時在畫布上畫一隻簡單的像素貓
   （用基本矩形組合，不需要複雜，讓用戶知道可以修改）

7. Props：
   onComplete: (dataURL: string) => void
   onStroke?: () => void  ← 每筆畫結束時呼叫（給 ONNX 用）

8. 支援 touch 事件（touchstart, touchmove, touchend）
   所有 touch 事件 e.preventDefault()

9. 畫筆粗細：像素格整數倍，每次 fillRect(snappedX, snappedY, 8, 8)
   座標必須 snap 到 8px 格子：Math.floor(x/8)*8

CSS：
  畫布外框：3px solid var(--color-border)
  box-shadow: 5px 5px 0 var(--color-border)
  背景過渡：background-color 可程式化改變（給 ONNX 反饋用）
  cursor: crosshair

所有 canvas 操作：ctx.imageSmoothingEnabled = false
```

---

## STEP 4 — ONNX 即時驗證

```
讀取 CLAUDE.md。

建立 src/engine/OnnxValidator.ts。

功能：在瀏覽器內用 ONNX Runtime Web 即時判斷畫的東西
      像不像一個生物（分數 0–1）

class OnnxValidator：
  - constructor()：自動嘗試載入 /models/pet_validator.onnx
    如果載入失敗（MVP 階段模型未就緒），設 this.ready = false
    不拋出錯誤，靜默失敗

  - async validate(canvas: HTMLCanvasElement): Promise<ValidationResult>
    返回 { score: number, label: string, ready: boolean }
    如果 ready = false，直接返回 { score: 0.7, label: 'ok', ready: false }
    （MVP 階段模型未就緒時預設通過）

  - getBackgroundColor(score: number): string
    score >= 0.6：返回 '#F0FFF4'（淡綠，表示像生物）
    score >= 0.3：返回 '#FFFFF0'（淡黃，中等）
    score < 0.3：返回 '#FFF5F5'（淡紅，不像生物）

MVP 階段說明：
  /public/models/ 目錄下目前沒有真實模型
  validator 設計為 graceful degradation
  ready = false 時所有驗證自動通過，score 回傳 0.75
  這讓我們可以先完成 UI，之後再插入真實 ONNX 模型

用 onnxruntime-web 套件，import 方式：
  import * as ort from 'onnxruntime-web'
```

---

## STEP 5 — Claude Vision API 串接

```
讀取 CLAUDE.md。

分兩部分：

【前端】建立 src/api/aiRecognize.ts：

  interface PetCoords {
    eyes:     { x: number; y: number }[];
    legs:     { x: number; y: number }[];
    center:   { x: number; y: number };
    has_eyes: boolean;
    has_legs: boolean;
  }

  async function recognizePet(imageDataURL: string): Promise<PetCoords>
  
  流程：
  1. POST /api/recognize，body: { image: imageDataURL }
  2. 等待後端回傳 PetCoords JSON
  3. 如果失敗或超時（5秒），返回 DEFAULT_COORDS：
     eyes: [{x:0.35,y:0.28},{x:0.65,y:0.28}]
     legs: [{x:0.25,y:0.85},{x:0.45,y:0.85},{x:0.55,y:0.85},{x:0.75,y:0.85}]
     center: {x:0.5,y:0.5}
     has_eyes: false, has_legs: false

【後端】建立 server/routes/recognize.ts：

  POST /api/recognize
  body: { image: string }

  流程：
  1. 用 @google/generative-ai SDK 呼叫 gemini-1.5-flash
  2. 傳入圖片（base64）+ 這個 prompt：
  "分析這張手繪寵物圖。找出並以圖片寬高的 0.0-1.0 百分比返回：
   eyes: 看起來像眼睛的區域中心座標陣列
   legs: 底部看起來像腿或腳的區域座標陣列
   center: 整個生物的視覺重心
   has_eyes: 是否找到明確眼睛（boolean）
   has_legs: 是否找到明確腿部（boolean）
   只返回 JSON，不要任何說明文字。"
  3. 解析回傳 JSON，返回 PetCoords
  4. 錯誤時返回 DEFAULT_COORDS

同時建立 server/index.ts：Express 服務器，載入 recognize 路由，port 3001
在根目錄 package.json 加入 "dev:server" script 跑後端

需要安裝：npm install @google/generative-ai express
GEMINI_API_KEY 從 process.env.GEMINI_API_KEY 讀取
```

---

## STEP 6 — PetAnimator 動畫引擎

```
讀取 CLAUDE.md。

建立 src/engine/PetAnimator.ts。

class PetAnimator：

  constructor(canvas: HTMLCanvasElement, petData: PetAnimData)
  
  interface PetAnimData {
    imageDataURL: string;   ← 用戶畫的圖
    coords: PetCoords;      ← Claude Vision 識別的座標
    size: number;           ← 顯示尺寸（48 或 64）
  }

  方法：
  - start(): void    開始 rAF 動畫循環
  - stop(): void     取消 rAF，清理資源
  - setState(state: PetState): void
  
  type PetState = 'idle' | 'walk' | 'eat' | 'play' | 'sleep' | 'sad'

  動畫邏輯（每幀）：
  
  1. 清除 canvas
  
  2. 計算當前 bob（浮動）：
     Math.round(Math.sin(bobTime) * 2)
     bobTime += 0.055 每幀
  
  3. 繪製地面陰影：
     橢圓，寬度 size*0.6，高 4px
     opacity = 0.10 + (1 - (bob+2)/4) * 0.10
     位置：底部 4px
  
  4. 繪製寵物圖片：
     ctx.drawImage(img, 2, 2+bob, size-4, size-12)
     image-rendering: pixelated
  
  5. 眨眼效果（只在 idle/walk 狀態）：
     blinkTimer += 0.028 每幀
     blinkCycle = 3.5 + (Math.random()-0.5)*3（每次眨完後重新隨機）
     當 blinkTimer >= blinkCycle 時觸發眨眼：
       眨眼持續 6 幀（約 100ms）
       在每個 eye 座標畫一個半透明矩形覆蓋
       eye 座標 = coords.eyes[i].x * size, coords.eyes[i].y * size
       矩形高度：正常眼高的 20%
  
  6. 走路腿部動畫（walk 狀態）：
     legTime += 0.1 每幀
     對每個 leg 座標：
       offset = Math.round(Math.sin(legTime + i * Math.PI) * 5)
       在 leg 座標下方畫 4×4 深色矩形，y += offset
  
  7. 狀態動畫（eat/play/sleep）：
     eat：嘴部位置（center.x, center.y + 0.15）的像素上下 2 幀循環
     play：整體額外 -6px 跳躍，sin 波快速
     sleep：閉眼（eye 完全覆蓋），legTime 停止
     sad：整體下移 3px，legTime 停止

所有座標必須 Math.round()。
ctx.imageSmoothingEnabled = false。
```

---

## STEP 7 — DrawScene 首頁整合

```
讀取 CLAUDE.md。

建立 src/scenes/DrawScene.tsx 和 DrawScene.module.css。

這是整個遊戲的首頁，像 drawafish.com 一樣極簡。

頁面結構（由上到下，沒有其他東西）：

1. 標題區：
   <h1>OODLE</h1>  ← Press Start 2P，28px，置中
   <p>draw a pet. make it live.</p>  ← VT323，16px，灰色

2. PixelCanvas 元件（240×240）
   onStroke={() => runOnnxValidation()}  ← 每筆畫後驗證
   onComplete={(url) => setPetDataURL(url)}

3. ONNX 反饋：
   畫布下方一行小字，顯示當前分數和提示
   score >= 0.6：顯示「looks like a creature! ✓」（綠色）
   score < 0.3：顯示「keep drawing...」（灰色）
   OnnxValidator.ready = false 時：不顯示此行

4. MAKE IT LIVE 按鈕：
   用 PixelButton variant="cta" size="lg"
   label="✦ MAKE IT LIVE ✦"
   點擊後：
   a. 按鈕文字變「BRINGING TO LIFE...」，disabled = true
   b. 顯示 loading spinner（像素風格，用 CSS steps() 動畫）
   c. 呼叫 recognizePet(petDataURL)
   d. 得到 coords 後，呼叫 onPetCreated(petDataURL, coords)
   e. 觸發粒子特效（見下方）

5. 粒子特效（按 MAKE IT LIVE 時）：
   在按鈕周圍生成 12 個文字粒子：['✦','★','♥','✿','◆','•']
   各自向外飛散（random angle, 60-120px 距離）
   animation: steps(6)，duration 0.9s，之後自動移除
   用 position: fixed，pointer-events: none

6. 底部寵物遊行（PetParade）：
   56px 高橫條，background: var(--color-bg)
   border-top: 2px solid var(--color-border)
   從 localStorage 讀取所有已創建寵物
   每隻用小型 canvas（40×40）渲染並走動
   點擊飄出 ♥

Props：
  onPetCreated: (pixelData: string, coords: PetCoords) => void
  ← 創建完成後父元件切換到 RoomScene

CSS：
  整個頁面：display flex，flex-direction column，align-items center
  gap: 16px，padding: 32px 20px
  min-height: 100vh
  背景：var(--color-bg)
```

---

## STEP 8 — StatBar 元件

```
讀取 CLAUDE.md。

建立 src/ui/StatBar.tsx 和 StatBar.module.css。

Props：
  label: string          ← '🍖' / '💛' / '⚡'
  value: number          ← 0–100
  color: string          ← CSS 顏色變數名
  maxWidth?: number      ← 預設 80px

視覺規格：
  外框：2px solid var(--color-border)，border-radius: 0，無圓角
  高度：8px
  內部填充：根據 value/100 計算寬度
  
  刻度線：每 25% 一條細線（25%, 50%, 75%），高度 100%，opacity 0.3
  
  顏色閾值：
  value >= 70：用傳入的 color
  40–69：#F0C040（黃色）
  < 40：#FF5A5F（紅色）
  < 20：加上閃爍動畫 CSS @keyframes blink，steps(2)，0.5s infinite

  數字顯示：進度條右側，Press Start 2P，8px
  
  整體 layout：
  icon + bar + number 水平排列，gap: 6px，align-items: center
```

---

## STEP 9 — RoomScene 寵物的家

```
讀取 CLAUDE.md。

建立 src/scenes/RoomScene.tsx 和 RoomScene.module.css。

這個場景在 DrawScene 按下 MAKE IT LIVE 後展開（不換頁）。

Props：
  petData: { pixelData: string; coords: PetCoords; name: string }
  onGoToPlaza: () => void

場景背景（純 CSS，像素室內）：

  牆壁（上半部 60%）：
    background: #D4C5B0
    repeating-linear-gradient 壁紙條紋效果

  地板（下半部 40%）：
    background: #8B6914
    repeating-linear-gradient 木板紋

  窗戶（左牆）：
    純 CSS 繪製，40×60px
    background: #1a1a2e（夜空）
    內有 4 個小白點（星星，用 box-shadow 製造）
    border: 3px solid #5a4a3a，分割線

  書架（右牆）：
    純 CSS，3 層，有幾本不同顏色的小書

  盆栽（右下角）：
    用 CSS 或簡單 SVG，像素圓形植物

寵物動畫：
  canvas 48×48，置中在房間地板上
  用 PetAnimator 渲染，state = 'walk'
  左右走動：每幀 x += 0.5，碰牆 scaleX(-1) 翻轉
  地板有橢圓陰影跟隨

HUD（左上角浮動面板）：
  background: rgba(255,255,255,0.9)
  border: 2px solid var(--color-border)
  box-shadow: 3px 3px 0 var(--color-border)
  padding: 10px 12px
  三行 StatBar（hunger / happy / energy）

右上角 DAY 計數器：
  背景同 HUD
  Press Start 2P，10px
  文字：DAY <number>

行動欄（底部，固定）：
  三個 PixelButton：
  FEED → stats.hunger = min(100, hunger + 20)，播放 eat 動畫，浮出 🍖
  PLAY → stats.happy = min(100, happy + 15)，播放 play 動畫，浮出 ⭐
  SLEEP → stats.energy = min(100, energy + 25)，播放 sleep 動畫，浮出 💤
  
  GO TO PLAZA → 呼叫 onGoToPlaza()

浮動文字動畫：
  絕對定位，按下按鈕後從寵物頭頂浮出
  animation: steps(8)，1s，translateY(-40px)，opacity 0 → 1 → 0

對話泡泡（SpeechBubble）：
  白底，2px 黑邊，像素三角箭頭
  VT323 字體，14px
  FEED 隨機：「好吃！」「謝謝！」「再來一份！」
  PLAY 隨機：「好開心！」「玩更多！」「嘻嘻！」
  SLEEP 隨機：「zZz...」「好累...」「晚安...」
  顯示 2 秒後消失

狀態持久化：
  所有 stats 存 localStorage key：'oodle_stats'
  lastFedAt 存 localStorage key：'oodle_last_fed'
  dayCount 存 localStorage key：'oodle_day_count'
  元件 mount 時讀取，unmount 時寫入
```

---

## 完成 Week 1 後驗收清單

在瀏覽器確認以下都正常：

- [ ] 首頁載入，看到 OODLE 標題和示例像素貓
- [ ] 可以用滑鼠在畫布上畫圖（8px 格子 snap）
- [ ] 顏色板可以切換，橡皮擦可以用
- [ ] Undo 有效（最多 20 步）
- [ ] 每筆畫後背景顏色有變化（ONNX 反饋，即使 model 未載入也要有預設反饋）
- [ ] 按 MAKE IT LIVE 有粒子特效
- [ ] 按鈕有 loading 狀態
- [ ] RoomScene 展開，看到像素房間
- [ ] 寵物在房間裡走動、眨眼
- [ ] FEED / PLAY / SLEEP 有反饋動畫
- [ ] 狀態條數值變化正確
- [ ] 重新整理後狀態從 localStorage 恢復

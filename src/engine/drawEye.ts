// src/engine/drawEye.ts
// All eyes drawn as pixel art using fillRect — no arc/bezier.
// Each "dot" is p×p pixels where p = floor(size/4).

export function drawEye(
  ctx: CanvasRenderingContext2D,
  style: string,
  cx: number,
  cy: number,
  size: number,
  blink: boolean,
  color: string = '#eaeaea',
): void {
  const p = Math.max(1, Math.floor(size / 4))

  const dot = (r: number, c: number, fill: string = color) => {
    ctx.fillStyle = fill
    ctx.fillRect(Math.round(cx + c * p), Math.round(cy + r * p), p, p)
  }

  if (blink) {
    for (let c = -2; c <= 2; c++) dot(0, c)
    return
  }

  switch (style) {
    case 'eye_round': {
      // 3×3 block with top-left highlight
      for (let r = -1; r <= 1; r++) {
        for (let c = -1; c <= 1; c++) dot(r, c)
      }
      dot(-1, -1, '#ffffff')
      break
    }
    case 'eye_happy': {
      // ^ arc: top row + extended bottom
      dot(-1, -1); dot(-1, 0); dot(-1, 1)
      dot(0, -2); dot(0, -1); dot(0, 0); dot(0, 1); dot(0, 2)
      break
    }
    case 'eye_sleepy': {
      dot(0, -2); dot(0, -1); dot(0, 0); dot(0, 1); dot(0, 2)
      break
    }
    case 'eye_star': {
      const s = '#f5a623'
      dot(0, 0, s)
      dot(-2, 0, s); dot(2, 0, s)
      dot(0, -2, s); dot(0, 2, s)
      dot(-1, -1, s); dot(-1, 1, s)
      dot(1, -1, s); dot(1, 1, s)
      break
    }
    case 'eye_heart': {
      // 5×5 pixel heart pattern
      const h = '#e94560'
      dot(-2, -1, h); dot(-2, 1, h)
      dot(-1, -2, h); dot(-1, -1, h); dot(-1, 0, h); dot(-1, 1, h); dot(-1, 2, h)
      dot(0, -2, h);  dot(0, -1, h);  dot(0, 0, h);  dot(0, 1, h);  dot(0, 2, h)
      dot(1, -1, h);  dot(1, 0, h);   dot(1, 1, h)
      dot(2, 0, h)
      break
    }
    case 'eye_x': {
      const x = '#e94560'
      dot(-1, -1, x); dot(-1, 1, x)
      dot(0, 0, x)
      dot(1, -1, x);  dot(1, 1, x)
      break
    }
    default: {
      for (let r = -1; r <= 1; r++) {
        for (let c = -1; c <= 1; c++) dot(r, c)
      }
    }
  }
}

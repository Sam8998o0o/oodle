type PetDataInput = { pixelData: string; name: string }

export async function generateShareCard(
  petData: PetDataInput,
  dayCount: number,
  petId: string,
): Promise<Blob> {
  const W = 1080
  const H = 1350

  const canvas = document.createElement('canvas')
  canvas.width  = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  // Load pixel font; fall back to monospace if unavailable
  let fontFamily = '"Press Start 2P", monospace'
  try {
    await document.fonts.load('16px "Press Start 2P"')
  } catch {
    fontFamily = 'monospace'
  }

  // ── Background ────────────────────────────────────────────
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, W, H)

  // ── Corner accent pixels ──────────────────────────────────
  const accentSz = 16
  ctx.fillStyle = '#e94560'
  ctx.fillRect(0, 0, accentSz, accentSz)
  ctx.fillRect(W - accentSz, 0, accentSz, accentSz)
  ctx.fillRect(0, H - accentSz, accentSz, accentSz)
  ctx.fillRect(W - accentSz, H - accentSz, accentSz, accentSz)

  // ── Scattered pixel stars ─────────────────────────────────
  const STAR_COLORS = ['#ffffff', '#4ecca3', '#f5a623', '#e94560', '#aaaaff', '#eaeaea']
  for (let i = 0; i < 90; i++) {
    const sx   = Math.floor(Math.random() * W)
    const sy   = Math.floor(Math.random() * H)
    const ssz  = Math.random() < 0.20 ? 6 : Math.random() < 0.45 ? 4 : 2
    ctx.fillStyle = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]
    ctx.fillRect(sx, sy, ssz, ssz)
  }

  // ── Pet image frame ───────────────────────────────────────
  const petX = (W - 600) / 2   // 240
  const petY = 100
  // outer border
  ctx.fillStyle = '#e94560'
  ctx.fillRect(petX - 8, petY - 8, 616, 616)
  // inner inset (reveals 4 px)
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(petX - 4, petY - 4, 608, 608)
  // pet background
  ctx.fillStyle = '#0f3460'
  ctx.fillRect(petX, petY, 600, 600)

  // ── Pet image (pixel-perfect scaling) ────────────────────
  await new Promise<void>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, petX, petY, 600, 600)
      resolve()
    }
    img.onerror = () => reject(new Error('Pet image failed to load'))
    img.src = petData.pixelData
  })

  // ── Pet name ──────────────────────────────────────────────
  const nameTxt = petData.name.toUpperCase()
  let namePx = 52
  ctx.font = `${namePx}px ${fontFamily}`
  while (ctx.measureText(nameTxt).width > W - 80 && namePx > 22) {
    namePx -= 4
    ctx.font = `${namePx}px ${fontFamily}`
  }
  const nameY = 810
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  // pixel shadow: draw black copy offset by 4px
  ctx.fillStyle = '#000000'
  ctx.fillText(nameTxt, W / 2 + 4, nameY + 4)
  ctx.fillStyle = '#eaeaea'
  ctx.fillText(nameTxt, W / 2, nameY)

  // ── DAY badge ─────────────────────────────────────────────
  const dayTxt  = `DAY ${dayCount}`
  ctx.font      = `32px ${fontFamily}`
  const dayTxtW = ctx.measureText(dayTxt).width
  const badgeW  = dayTxtW + 64
  const badgeH  = 64
  const badgeX  = (W - badgeW) / 2
  const badgeY  = 882
  // shadow (4px offset, no blur)
  ctx.fillStyle = '#000000'
  ctx.fillRect(badgeX + 4, badgeY + 4, badgeW, badgeH)
  // badge fill
  ctx.fillStyle = '#f5a623'
  ctx.fillRect(badgeX, badgeY, badgeW, badgeH)
  // badge text
  ctx.fillStyle    = '#1a1a2e'
  ctx.textBaseline = 'middle'
  ctx.fillText(dayTxt, W / 2, badgeY + badgeH / 2)

  // ── Horizontal divider ────────────────────────────────────
  ctx.fillStyle = '#e94560'
  ctx.fillRect(60, 1150, W - 120, 4)

  // ── Link text ─────────────────────────────────────────────
  const shortId = petId.slice(0, 8)
  const linkTxt = `oodle.vercel.app/pet/${shortId}…`
  ctx.font         = `22px ${fontFamily}`
  ctx.fillStyle    = '#4ecca3'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(linkTxt, W / 2, 1230)

  // ── "OODLE" wordmark ──────────────────────────────────────
  ctx.font         = `18px ${fontFamily}`
  ctx.fillStyle    = '#555'
  ctx.textAlign    = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText('OODLE', W - 44, 1310)

  // ── Export ────────────────────────────────────────────────
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('toBlob returned null'))
    }, 'image/png')
  })
}

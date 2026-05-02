import { Router, Request, Response } from 'express'
import { GoogleGenerativeAI } from '@google/generative-ai'

const router = Router()

interface PetCoords {
  eyes:     { x: number; y: number }[]
  legs:     { x: number; y: number }[]
  center:   { x: number; y: number }
  has_eyes: boolean
  has_legs: boolean
}

const DEFAULT_COORDS: PetCoords = {
  eyes:     [{ x: 0.35, y: 0.28 }, { x: 0.65, y: 0.28 }],
  legs:     [{ x: 0.25, y: 0.85 }, { x: 0.45, y: 0.85 },
             { x: 0.55, y: 0.85 }, { x: 0.75, y: 0.85 }],
  center:   { x: 0.5, y: 0.5 },
  has_eyes: false,
  has_legs: false,
}

const PROMPT = `分析這張手繪寵物圖。找出並以圖片寬高的 0.0-1.0 百分比返回：
eyes: 看起來像眼睛的區域中心座標陣列
legs: 底部看起來像腿或腳的區域座標陣列
center: 整個生物的視覺重心
has_eyes: 是否找到明確眼睛（boolean）
has_legs: 是否找到明確腿部（boolean）
只返回 JSON，不要任何說明文字。`

router.post('/', async (req: Request, res: Response) => {
  console.log('[recognize] POST received')
  try {
    const { image } = req.body as { image: string }
    if (!image) {
      console.log('[recognize] no image in body → DEFAULT_COORDS')
      res.json(DEFAULT_COORDS)
      return
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      console.log('[recognize] GEMINI_API_KEY not set → DEFAULT_COORDS')
      res.json(DEFAULT_COORDS)
      return
    }

    console.log('[recognize] calling Gemini...')
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const base64 = image.replace(/^data:image\/\w+;base64,/, '')

    const result = await model.generateContent([
      PROMPT,
      { inlineData: { mimeType: 'image/png', data: base64 } },
    ])

    const text = result.response.text().trim()
    console.log('[recognize] Gemini raw response:', text)

    const json = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '')
    const coords = JSON.parse(json) as PetCoords

    console.log('[recognize] parsed coords:', JSON.stringify(coords))
    res.json(coords)
  } catch (err) {
    console.error('[recognize] ERROR:', err)
    res.json(DEFAULT_COORDS)
  }
})

export default router

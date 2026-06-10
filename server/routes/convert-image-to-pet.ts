import { Router, Request, Response } from 'express'
import { GoogleGenerativeAI } from '@google/generative-ai'

const router = Router()

const PIXEL_STYLE =
  'Convert this character image into retro 8-bit pixel art for a virtual pet game. ' +
  '64×64 pixels, bold black outlines, max 16 colors, black background, ' +
  'centered, cute and simple creature design. Keep the character recognizable. ' +
  'Output only the pixel art image, no text.'

router.post('/', async (req: Request, res: Response) => {
  console.log('[convert-image-to-pet] POST received')
  try {
    const { imageUrl, imageBase64, mimeType: bodyMimeType } = req.body as {
      imageUrl?: string
      imageBase64?: string
      mimeType?: string
    }

    if (!imageUrl && !imageBase64) {
      res.status(400).json({ error: 'imageUrl or imageBase64 required' })
      return
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      res.status(503).json({ error: 'GEMINI_API_KEY not configured' })
      return
    }

    let base64: string
    let mimeType: string

    if (imageUrl) {
      // Fetch image server-side to avoid CORS issues
      const response = await fetch(imageUrl)
      if (!response.ok) {
        res.status(400).json({ error: 'Failed to fetch character image' })
        return
      }
      const contentType = response.headers.get('content-type') ?? 'image/png'
      mimeType = contentType.split(';')[0].trim()
      const buffer = await response.arrayBuffer()
      base64 = Buffer.from(buffer).toString('base64')
    } else {
      base64 = imageBase64!
      mimeType = bodyMimeType ?? 'image/png'
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-preview-image-generation',
    })

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: PIXEL_STYLE },
        ],
      }],
      generationConfig: {
        responseModalities: ['image'],
      } as Record<string, unknown>,
    })

    const parts = result.response.candidates?.[0]?.content?.parts ?? []
    const imagePart = parts.find(
      (p) => (p as { inlineData?: { mimeType: string; data: string } }).inlineData?.mimeType?.startsWith('image/'),
    ) as { inlineData?: { mimeType: string; data: string } } | undefined

    if (!imagePart?.inlineData) {
      console.log('[convert-image-to-pet] no image part in response')
      res.status(500).json({ error: 'Conversion failed — no image returned' })
      return
    }

    const { mimeType: outMime, data } = imagePart.inlineData
    console.log('[convert-image-to-pet] converted, mimeType:', outMime)
    res.json({ image: `data:${outMime};base64,${data}` })
  } catch (err) {
    console.error('[convert-image-to-pet] ERROR:', err)
    res.status(500).json({ error: 'Conversion failed' })
  }
})

export default router

import { Router, Request, Response } from 'express'
import { GoogleGenerativeAI } from '@google/generative-ai'

const router = Router()

router.post('/create-eggs', async (req: Request, res: Response) => {
  try {
    const { pet1PixelData, pet2PixelData } = req.body as {
      pet1PixelData?: string
      pet2PixelData?: string
    }

    if (!pet1PixelData || !pet2PixelData) {
      res.status(400).json({ error: 'pet1PixelData and pet2PixelData required' })
      return
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      res.status(503).json({ error: 'GEMINI_API_KEY not configured' })
      return
    }

    const extractB64 = (dataUrl: string) => {
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
      return m ? { mimeType: m[1], data: m[2] } : { mimeType: 'image/png', data: dataUrl }
    }

    const p1 = extractB64(pet1PixelData)
    const p2 = extractB64(pet2PixelData)

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-preview-image-generation',
    })

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: p1.mimeType, data: p1.data } },
          { inlineData: { mimeType: p2.mimeType, data: p2.data } },
          {
            text: 'Combine these two pixel art characters into one cute baby pixel art creature. ' +
                  '64x64 pixels, simple design, colorful, retro 8-bit style, centered, ' +
                  'black background, max 16 colors, bold outlines.',
          },
        ],
      }],
      generationConfig: {
        responseModalities: ['image', 'text'],
      } as Record<string, unknown>,
    })

    const parts = result.response.candidates?.[0]?.content?.parts ?? []
    const imagePart = parts.find(
      (p) => (p as { inlineData?: { mimeType: string; data: string } }).inlineData?.mimeType?.startsWith('image/')
    ) as { inlineData?: { mimeType: string; data: string } } | undefined

    if (!imagePart?.inlineData) {
      console.log('[breed/create-eggs] no image part in response')
      res.status(500).json({ error: 'no image generated' })
      return
    }

    const { mimeType, data } = imagePart.inlineData
    console.log('[breed/create-eggs] baby generated, mimeType:', mimeType)
    res.json({ babyPixelData: `data:${mimeType};base64,${data}` })
  } catch (err) {
    console.error('[breed/create-eggs] ERROR:', err)
    res.status(500).json({ error: 'generation failed' })
  }
})

export default router

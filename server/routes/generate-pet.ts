import { Router, Request, Response } from 'express'
import { GoogleGenerativeAI } from '@google/generative-ai'

const router = Router()

const PIXEL_STYLE =
  'Retro 8-bit pixel art, 64×64 pixels, bold outlines, max 16 colors, ' +
  'black background, centered, cute and simple creature design.'

router.post('/', async (req: Request, res: Response) => {
  console.log('[generate-pet] POST received')
  try {
    const { prompt } = req.body as { prompt?: string }
    if (!prompt?.trim()) {
      res.status(400).json({ error: 'prompt required' })
      return
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      res.status(503).json({ error: 'GEMINI_API_KEY not configured' })
      return
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-preview-image-generation',
    })

    const fullPrompt = `${PIXEL_STYLE} Subject: ${prompt.trim()}.`

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      generationConfig: {
        responseModalities: ['image'],
      } as Record<string, unknown>,
    })

    const parts = result.response.candidates?.[0]?.content?.parts ?? []
    const imagePart = parts.find(
      (p) => (p as { inlineData?: { mimeType: string; data: string } }).inlineData?.mimeType?.startsWith('image/'),
    ) as { inlineData?: { mimeType: string; data: string } } | undefined

    if (!imagePart?.inlineData) {
      console.log('[generate-pet] no image part in response')
      res.status(500).json({ error: 'no image generated' })
      return
    }

    const { mimeType, data } = imagePart.inlineData
    console.log('[generate-pet] image generated, mimeType:', mimeType)
    res.json({ image: `data:${mimeType};base64,${data}` })
  } catch (err) {
    console.error('[generate-pet] ERROR:', err)
    res.status(500).json({ error: 'generation failed' })
  }
})

export default router

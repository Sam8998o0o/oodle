import Stripe from 'stripe'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { userId } = req.body
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      success_url: `${process.env.VITE_APP_URL ?? 'https://oodle.vercel.app'}/?subscribed=true`,
      cancel_url: `${process.env.VITE_APP_URL ?? 'https://oodle.vercel.app'}/`,
      metadata: { userId },
    })
    res.json({ url: session.url })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
}

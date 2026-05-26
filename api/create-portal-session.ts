import Stripe from 'stripe'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { userId } = req.body
  try {
    const { data } = await supabase.from('subscriptions').select('stripe_customer_id').eq('user_id', userId).single()
    if (!data?.stripe_customer_id) return res.status(404).json({ error: 'No customer found' })
    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${process.env.VITE_APP_URL ?? 'https://oodle.vercel.app'}/`,
    })
    res.json({ url: session.url })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
}

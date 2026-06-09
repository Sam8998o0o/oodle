import express, { Request, Response } from 'express'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const router = express.Router()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil',
})

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/create-checkout-session
router.post('/create-checkout-session', async (req: Request, res: Response) => {
  const { userId } = req.body as { userId: string }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    success_url: process.env.CLIENT_URL + '/?subscribed=true&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: process.env.CLIENT_URL,
    metadata: { userId },
    client_reference_id: userId,
  })

  res.json({ url: session.url })
})

// POST /api/create-coins-checkout-session
const COIN_PACKAGES: Record<string, { amountCents: number; coins: number; name: string }> = {
  coins_50:  { amountCents: 490,  coins: 50,  name: '50 Coins'  },
  coins_150: { amountCents: 1290, coins: 150, name: '150 Coins' },
  coins_350: { amountCents: 2490, coins: 350, name: '350 Coins' },
}

router.post('/create-coins-checkout-session', async (req: Request, res: Response) => {
  const { userId, petId, package: pkg } = req.body as { userId: string; petId: string; package: string }
  const selected = COIN_PACKAGES[pkg]
  if (!selected) { res.status(400).json({ error: 'Invalid coin package' }); return }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'myr',
        unit_amount: selected.amountCents,
        product_data: { name: `Oodle ${selected.name}` },
      },
      quantity: 1,
    }],
    success_url: process.env.CLIENT_URL + '/?coins_purchased=true',
    cancel_url:  process.env.CLIENT_URL,
    metadata: { userId, petId, pkg, coins: String(selected.coins) },
    client_reference_id: userId,
  })

  res.json({ url: session.url })
})

// POST /api/create-portal-session
router.post('/create-portal-session', async (req: Request, res: Response) => {
  const { userId } = req.body as { userId: string }

  const { data } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .single()

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: data!.stripe_customer_id,
    return_url: process.env.CLIENT_URL,
  })

  res.json({ url: portalSession.url })
})

// POST /api/webhook/stripe  (must be mounted with express.raw())
router.post('/webhook/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    res.status(400).json({ error: 'Webhook signature verification failed' })
    return
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session

      if (session.mode === 'payment') {
        // One-time coin purchase
        const petId      = session.metadata?.petId
        const coinsToAdd = parseInt(session.metadata?.coins ?? '0', 10)
        if (petId && coinsToAdd > 0) {
          await supabase.rpc('add_coins', { p_pet_id: petId, p_amount: coinsToAdd })
        }
        break
      }

      // Subscription checkout
      const userId = session.metadata?.userId ?? session.client_reference_id
      if (!userId) break

      const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
      await supabase.rpc('upsert_subscription', {
        p_user_id:            userId,
        p_stripe_sub_id:      subscription.id,
        p_stripe_customer_id: subscription.customer as string,
        p_status:             'active',
        p_period_start:       new Date(subscription.current_period_start * 1000).toISOString(),
        p_period_end:         new Date(subscription.current_period_end * 1000).toISOString(),
      })
      break
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice
      const subId = invoice.subscription as string
      const subscription = await stripe.subscriptions.retrieve(subId)

      const { data } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_subscription_id', subId)
        .single()

      if (data) {
        await supabase.rpc('upsert_subscription', {
          p_user_id:            data.user_id,
          p_stripe_sub_id:      subscription.id,
          p_stripe_customer_id: subscription.customer as string,
          p_status:             'active',
          p_period_start:       new Date(subscription.current_period_start * 1000).toISOString(),
          p_period_end:         new Date(subscription.current_period_end * 1000).toISOString(),
        })
      }
      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription

      const { data } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_subscription_id', subscription.id)
        .single()

      if (data) {
        await supabase.rpc('upsert_subscription', {
          p_user_id:            data.user_id,
          p_stripe_sub_id:      subscription.id,
          p_stripe_customer_id: subscription.customer as string,
          p_status:             subscription.status === 'active' ? 'active' : 'cancelled',
          p_period_start:       new Date(subscription.current_period_start * 1000).toISOString(),
          p_period_end:         new Date(subscription.current_period_end * 1000).toISOString(),
        })
      }
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription

      const { data } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_subscription_id', subscription.id)
        .single()

      if (data) {
        await supabase.rpc('upsert_subscription', {
          p_user_id:            data.user_id,
          p_stripe_sub_id:      subscription.id,
          p_stripe_customer_id: subscription.customer as string,
          p_status:             'cancelled',
          p_period_start:       new Date(subscription.current_period_start * 1000).toISOString(),
          p_period_end:         new Date(subscription.current_period_end * 1000).toISOString(),
        })
      }
      break
    }
  }

  res.json({ received: true })
})

export default router

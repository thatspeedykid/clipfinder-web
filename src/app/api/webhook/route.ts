// src/app/api/webhook/route.ts
// LemonSqueezy webhook — fires when someone subscribes, cancels, etc.
// Set your webhook URL in LemonSqueezy to: https://yourapp.vercel.app/api/webhook

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'

// Map LemonSqueezy variant IDs → your tiers
const VARIANT_TO_TIER: Record<string, string> = {
  [process.env.LEMONSQUEEZY_PRO_VARIANT_ID!]:    'pro',
  [process.env.LEMONSQUEEZY_AGENCY_VARIANT_ID!]: 'agency',
}

function verifySignature(payload: string, signature: string): boolean {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET!
  const hmac = crypto.createHmac('sha256', secret)
  const digest = hmac.update(payload).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-signature') ?? ''

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(rawBody)
  const eventName: string = event.meta?.event_name ?? ''
  const data = event.data?.attributes ?? {}

  const supabase = createAdminClient()

  // Get user email from LemonSqueezy order
  const customerEmail: string = data.user_email ?? data.customer_email ?? ''
  const variantId = String(data.variant_id ?? '')
  const customerId = String(data.customer_id ?? '')
  const subscriptionId = String(event.data?.id ?? '')

  console.log(`[webhook] ${eventName} — ${customerEmail} — variant ${variantId}`)

  switch (eventName) {
    case 'subscription_created':
    case 'subscription_updated':
    case 'subscription_resumed': {
      const tier = VARIANT_TO_TIER[variantId] ?? 'pro'
      await supabase
        .from('profiles')
        .update({
          tier,
          ls_customer_id: customerId,
          ls_subscription_id: subscriptionId,
        })
        .eq('email', customerEmail)
      console.log(`[webhook] upgraded ${customerEmail} → ${tier}`)
      break
    }

    case 'subscription_cancelled':
    case 'subscription_expired':
    case 'subscription_paused': {
      await supabase
        .from('profiles')
        .update({ tier: 'free' })
        .eq('email', customerEmail)
      console.log(`[webhook] downgraded ${customerEmail} → free`)
      break
    }

    default:
      console.log(`[webhook] unhandled event: ${eventName}`)
  }

  return NextResponse.json({ received: true })
}

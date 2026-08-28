// LemonSqueezy subscription checkout used to gate app access behind payment, layered on top
// of the Supabase login in authConfig.ts.
//
// Switched from Paddle: Paddle's merchant review kept rejecting this app (common for
// AI image/video generation tools — flagged as higher-risk for NSFW/deepfake misuse).
// LemonSqueezy hosts its own checkout page directly (no separate Netlify-hosted checkout
// page needed like the old Paddle setup — see checkout-page/ for the leftover legal pages,
// which LemonSqueezy's own store setup still wants links to).
//
// LEMONSQUEEZY_CHECKOUT_URL is your subscription variant's hosted checkout link:
//   LemonSqueezy Dashboard → Store → Products → your subscription product → variant →
//   "Copy checkout URL" (or the Share/Checkout-link button). Looks like:
//   https://YOUR-STORE.lemonsqueezy.com/buy/YOUR-VARIANT-UUID
//
// The app appends the logged-in user's email and Supabase user id as query params
// (checkout[email], checkout[custom][user_id]) when opening it — LemonSqueezy echoes
// custom_data back in webhook events, so the webhook can identify the Supabase user without
// an extra lookup step (unlike Paddle, which required resolving customer_id → email → user).
//
// The actual payment status comes from a Supabase Edge Function (lemonsqueezy-webhook) that
// verifies LemonSqueezy's webhook signature and writes into the `subscriptions` table —
// nothing payment-related is trusted from the client itself.
//
// Leave this empty to skip the paywall entirely: users only need to log in, exactly as before
// this feature existed.
export const LEMONSQUEEZY_CHECKOUT_URL =
  'https://oneflow.lemonsqueezy.com/checkout/buy/2b5b7ba4-fe7f-461b-a989-7abd68c3c8dd';

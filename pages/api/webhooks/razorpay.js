// Alias so the webhook can be registered as /api/webhooks/razorpay in the Razorpay dashboard.
// Same handler as /api/razorpay-webhook. `config` must be declared literally in this file.
export { default } from '../razorpay-webhook';
export const config = { api: { bodyParser: false } };

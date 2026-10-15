// Background reconcile for a long-running node/pm2 server: a payment whose webhook and browser
// callback were both missed gets fixed within a few minutes, with no external cron needed.
import { reconcileUnpaid } from './lib/reconcile';

if (process.env.DATABASE_URL && process.env.RAZORPAY_KEY_SECRET) {
  const run = () => reconcileUnpaid().then(
    (r) => { if (r.fixed.length) console.log('[reconcile] fixed', r.fixed.join(',')); },
    (e) => console.error('[reconcile] run failed:', e.message)
  );
  setTimeout(run, 30 * 1000);
  const t = setInterval(run, 3 * 60 * 1000);
  t.unref?.();
}

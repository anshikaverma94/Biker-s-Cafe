import { getSeatsLeft } from '../../lib/db';
import { TOTAL_SEATS } from '../../lib/config';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    return res.status(200).json({ seatsLeft: await getSeatsLeft(), total: TOTAL_SEATS });
  } catch (e) {
    return res.status(200).json({ seatsLeft: null, total: TOTAL_SEATS }); // unknown: don't block the page
  }
}

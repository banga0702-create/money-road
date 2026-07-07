// api/cron.js - 매일 15:35 KST 자동 실행 (향후 확장용)
export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.status(200).json({ message: '크론잡 실행 완료' });
}

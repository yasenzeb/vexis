import { setCorsHeaders, safeError } from './_auth.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return res.status(400).json({ success: false, error: 'TELEGRAM_BOT_TOKEN is not set' });
    }

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    
    // Construct the webhook URL
    const webhookUrl = `${protocol}://${host}/api/telegram-webhook`;

    // Call Telegram API to set the webhook
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl })
    });

    const data = await tgRes.json();
    return res.status(200).json({ success: true, webhookUrl, telegram_response: data });
  } catch (err) {
    console.error('[Set Webhook Error]', err);
    return res.status(500).json({ success: false, error: safeError(err) });
  }
}

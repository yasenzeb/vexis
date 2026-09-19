import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders, isRateLimited, safeError } from './_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_URL_PATTERNS = [
  /^https:\/\/res\.cloudinary\.com\//,
  /^https:\/\/[a-zA-Z0-9-]+\.supabase\.co\/storage\//,
];

function isAllowedReceiptUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return ALLOWED_URL_PATTERNS.some(p => p.test(url));
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown';
  if (isRateLimited(`order-receipt:${ip}`, 10, 10 * 60 * 1000)) {
    return res.status(429).json({ success: false, error: 'محاولات كثيرة، حاول لاحقاً.' });
  }

  try {
    const { order_number, receipt_url } = req.body || {};

    if (!order_number || !receipt_url) {
      return res.status(400).json({ success: false, error: 'بيانات ناقصة.' });
    }

    const safeOrderNumber = String(order_number)
      .replace(/[^A-Z0-9\-]/g, '')
      .substring(0, 30);

    if (!safeOrderNumber) {
      return res.status(400).json({ success: false, error: 'رقم الطلب غير صحيح.' });
    }

    if (!isAllowedReceiptUrl(receipt_url)) {
      return res.status(400).json({ success: false, error: 'رابط الإيصال غير مسموح به.' });
    }

    // Try updating receipt_url if column exists, otherwise update status
    let data;
    const { data: updateData, error: updateErr } = await supabase
      .from('orders')
      .update({ receipt_url: receipt_url.substring(0, 1000), status: 'review' })
      .eq('order_number', safeOrderNumber)
      .select('order_number, customer_name, phone, total')
      .maybeSingle();

    if (updateErr) {
      // Fallback if receipt_url column doesn't exist in Supabase table schema
      console.warn('[order-receipt] receipt_url update failed, fallback to status update:', updateErr.message);
      const { data: fallbackData, error: fallbackErr } = await supabase
        .from('orders')
        .update({ status: 'review' })
        .eq('order_number', safeOrderNumber)
        .select('order_number, customer_name, phone, total')
        .single();
      if (fallbackErr) throw fallbackErr;
      data = fallbackData;
    } else {
      data = updateData;
    }

    if (!data) {
      return res.status(404).json({ success: false, error: 'الطلب غير موجود.' });
    }

    // Telegram photo notification with inline action buttons
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (token && chatId) {
      try {
        const caption = `🧾 <b>إيصال تحويل جديد!</b>\n` +
          `🆔 <b>رقم الطلب:</b> <code>${data.order_number}</code>\n` +
          `👤 <b>العميل:</b> ${data.customer_name}\n` +
          `📞 <b>الهاتف:</b> ${data.phone}\n` +
          `💰 <b>الإجمالي:</b> EGP ${data.total}`;

        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: '✅ قبول الإيصال وتأكيد الطلب', callback_data: `acc_${data.order_number}` },
            ],
            [
              { text: '❌ رفض الإيصال', callback_data: `rej_${data.order_number}` }
            ]
          ]
        };

        await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            photo: receipt_url,
            caption: caption,
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard
          })
        });
      } catch (tgErr) {
        console.error('[Telegram Receipt Photo Error]', tgErr);
      }
    }

    return res.status(200).json({
      success: true,
      order: { order_number: data.order_number },
    });

  } catch (err) {
    console.error('[API /order-receipt]', err);
    return res.status(500).json({ success: false, error: safeError(err) });
  }
}
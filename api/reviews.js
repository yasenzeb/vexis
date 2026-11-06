// api/_reviews.js — إدارة آراء العملاء
import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders, requireAdmin, isRateLimited, safeError } from './_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.APISUPABASE_SERVICE_ROLE_KEY
);

async function sendTelegram(message) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('[Telegram/Review]', e.message);
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // ── GET: fetch all reviews (public) ──────────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('reviews')
        .select('id, name, text, rating, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ success: true, reviews: data || [] });
    }

    // ── POST: submit a review (PUBLIC — no admin required) ───────────────────
    if (req.method === 'POST') {
      // Rate-limit: 3 reviews per IP per hour
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
      if (isRateLimited(`review:${ip}`, 3, 60 * 60 * 1000)) {
        return res.status(429).json({ success: false, error: 'ارسلت ريفيو قريباً، حاول بعد ساعة.' });
      }

      const { name, title, text, content, rating } = req.body || {};

      // Combine title + content if text is not provided directly
      const reviewText = (text || [title, content].filter(Boolean).join(' — ') || '').trim();
      const reviewName = (name || '').trim();

      if (!reviewName) {
        return res.status(400).json({ success: false, error: 'الاسم مطلوب.' });
      }
      if (!reviewText) {
        return res.status(400).json({ success: false, error: 'نص الريفيو مطلوب.' });
      }

      const parsedRating = parseInt(rating);
      if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
        return res.status(400).json({ success: false, error: 'التقييم يجب أن يكون بين 1 و 5.' });
      }

      const { data, error } = await supabase
        .from('reviews')
        .insert([{
          name:   reviewName.substring(0, 100),
          text:   reviewText.substring(0, 1000),
          rating: parsedRating
        }])
        .select()
        .single();

      if (error) throw error;

      // Notify admin on Telegram (fire & forget)
      const stars = '⭐'.repeat(parsedRating);
      sendTelegram(
        `💬 <b>ريفيو جديد على VEXIS!</b>\n\n` +
        `👤 <b>الاسم:</b> ${reviewName}\n` +
        `${stars} <b>التقييم:</b> ${parsedRating}/5\n` +
        `📝 <b>الريفيو:</b> ${reviewText.substring(0, 300)}`
      );

      return res.status(201).json({ success: true, review: data });
    }

    // ── DELETE: remove a review (admin only) ─────────────────────────────────
    if (req.method === 'DELETE') {
      if (!requireAdmin(req)) {
        return res.status(401).json({ success: false, error: 'غير مصرح.' });
      }

      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ success: false, error: 'id مطلوب في query string.' });
      }

      const { error } = await supabase
        .from('reviews')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return res.status(200).json({ success: true, message: 'تم حذف الريفيو.' });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    console.error('[API /reviews]', err);
    return res.status(500).json({ success: false, error: safeError(err) });
  }
}

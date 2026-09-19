// api/_telegram-webhook.js — Telegram Bot Webhook endpoint
import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders, safeError } from './_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function tgRequest(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (e) {
    console.error(`[TG ${method} Error]`, e.message);
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const update = req.body || {};

    // 1. Handle Callback Queries (Button Clicks)
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || ''; // Format: st_{order_number}_{status}
      const chatId = cb.message?.chat?.id;

      if (data.startsWith('st_')) {
        const parts = data.split('_');
        const status = parts.pop();
        const orderNumber = parts.slice(1).join('_');

        const statusLabels = {
          pending: 'معلق ⏳',
          review: 'جاري المراجعة ✅',
          shipped: 'خرج للشحن 🚚',
          delivered: 'تم التسليم 🎉',
          rejected: 'مرفوض ❌'
        };

        // Update order status in database
        const { error } = await supabase
          .from('orders')
          .update({ status: status })
          .eq('order_number', orderNumber);

        if (error) {
          await tgRequest('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: '❌ حدث خطأ أثناء تحديث حالة الطلب',
            show_alert: true
          });
        } else {
          await tgRequest('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: `✅ تم تغيير حالة الطلب #${orderNumber} إلى ${statusLabels[status] || status}`
          });

          await tgRequest('sendMessage', {
            chat_id: chatId,
            text: `🔄 <b>تحديث الحالة:</b>\nالطلب <code>${orderNumber}</code> أصبح الآن: <b>${statusLabels[status] || status}</b>`,
            parse_mode: 'HTML'
          });
        }
      }
      return res.status(200).json({ ok: true });
    }

    // 2. Handle Text Commands (/start, /orders, etc.)
    if (update.message && update.message.text) {
      const msg = update.message;
      const text = msg.text.trim();
      const chatId = msg.chat.id;

      if (text === '/start') {
        const helpText = `🔥 <b>أهلاً بك في بوت لوحة تحكم VEXIS!</b> 🔥\n\n` +
          `يمكنك استخدام الأوامر التالية للتحكم وإدارة الطلبات:\n\n` +
          `🔹 /orders — عرض أحدث 5 طلبات\n` +
          `🔹 /pending — عرض الطلبات المعلقة\n` +
          `🔹 /status [رقم الطلب] [الحالة] — تغيير حالة طلب معين\n\n` +
          `<i>الحالات المتاحة: pending, review, shipped, delivered, rejected</i>`;

        await tgRequest('sendMessage', {
          chat_id: chatId,
          text: helpText,
          parse_mode: 'HTML'
        });
      } else if (text === '/orders' || text === '/pending') {
        let query = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(5);
        if (text === '/pending') query = query.eq('status', 'pending');

        const { data: orders } = await query;
        if (!orders || orders.length === 0) {
          await tgRequest('sendMessage', { chat_id: chatId, text: '📭 لا توجد طلبات.' });
        } else {
          for (const ord of orders) {
            const ordMsg = `🆔 <b>${ord.order_number}</b>\n` +
              `👤 العميل: ${ord.customer_name} (${ord.phone})\n` +
              `📍 المحافظة: ${ord.governorate}\n` +
              `💰 الإجمالي: EGP ${ord.total}\n` +
              `📌 الحالة: <b>${ord.status}</b>`;

            const inlineKeyboard = {
              inline_keyboard: [
                [
                  { text: '✅ مراجعة (review)', callback_data: `st_${ord.order_number}_review` },
                  { text: '🚚 للشحن (shipped)', callback_data: `st_${ord.order_number}_shipped` }
                ],
                [
                  { text: '🎉 تم التسليم (delivered)', callback_data: `st_${ord.order_number}_delivered` },
                  { text: '❌ رفض (rejected)', callback_data: `st_${ord.order_number}_rejected` }
                ]
              ]
            };

            await tgRequest('sendMessage', {
              chat_id: chatId,
              text: ordMsg,
              parse_mode: 'HTML',
              reply_markup: inlineKeyboard
            });
          }
        }
      } else if (text.startsWith('/status')) {
        const parts = text.split(' ');
        if (parts.length >= 3) {
          const orderNum = parts[1];
          const newStatus = parts[2].toLowerCase();

          const { error } = await supabase
            .from('orders')
            .update({ status: newStatus })
            .eq('order_number', orderNum);

          if (error) {
            await tgRequest('sendMessage', { chat_id: chatId, text: '❌ خطأ: ' + error.message });
          } else {
            await tgRequest('sendMessage', { chat_id: chatId, text: `✅ تم تحديث حالة الطلب ${orderNum} إلى ${newStatus}` });
          }
        } else {
          await tgRequest('sendMessage', { chat_id: chatId, text: '⚠️ الاستخدام الصحيح: `/status [رقم الطلب] [الحالة]`' });
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Telegram Webhook Error]', err);
    return res.status(500).json({ success: false, error: safeError(err) });
  }
}

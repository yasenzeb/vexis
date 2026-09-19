// api/_telegram-webhook.js — Telegram Bot Webhook endpoint
import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders, safeError } from './_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Pending rejection: waiting for admin to type reason
const pendingRejection = {}; // { chatId: { orderNumber, messageId } }

async function tgRequest(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!json.ok) console.error(`[TG ${method}] Error:`, json);
    return json;
  } catch (e) {
    console.error(`[TG ${method} Error]`, e.message);
    return null;
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Always return 200 to Telegram immediately
  res.status(200).json({ ok: true });

  try {
    const update = req.body || {};
    console.log('[TG Webhook] Update:', JSON.stringify(update).substring(0, 500));

    // ── 1. Handle Callback Queries (Button Clicks) ──
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || '';
      const chatId = cb.message?.chat?.id;
      const messageId = cb.message?.message_id;

      // Answer immediately so the spinner goes away
      await tgRequest('answerCallbackQuery', { callback_query_id: cb.id });

      if (data.startsWith('st_')) {
        // Format: st_{order_number}_{status}
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

        if (status === 'rejected') {
          // Ask admin for rejection reason
          pendingRejection[chatId] = { orderNumber };
          await tgRequest('sendMessage', {
            chat_id: chatId,
            text: `⚠️ <b>رفض الطلب ${orderNumber}</b>\n\nاكتب سبب الرفض الآن وسيُرسل للعميل فوراً:`,
            parse_mode: 'HTML'
          });
          return;
        }

        // Update status in DB
        const { error: dbErr } = await supabase
          .from('orders')
          .update({ status, rejection_reason: null })
          .eq('order_number', orderNumber);

        if (dbErr) {
          await tgRequest('sendMessage', {
            chat_id: chatId,
            text: `❌ فشل تحديث الحالة: ${dbErr.message}`
          });
        } else {
          await tgRequest('sendMessage', {
            chat_id: chatId,
            text: `✅ <b>تم تحديث الطلب</b>\n🆔 <code>${orderNumber}</code>\n📌 الحالة: <b>${statusLabels[status] || status}</b>`,
            parse_mode: 'HTML'
          });
        }

      } else if (data.startsWith('acc_')) {
        // Accept receipt: acc_{order_number}
        const orderNumber = data.substring(4);
        const { error: dbErr } = await supabase
          .from('orders')
          .update({ status: 'review' })
          .eq('order_number', orderNumber);

        if (dbErr) {
          await tgRequest('sendMessage', { chat_id: chatId, text: `❌ خطأ: ${dbErr.message}` });
        } else {
          await tgRequest('sendMessage', {
            chat_id: chatId,
            text: `✅ <b>تم قبول الإيصال وتأكيد الطلب</b>\n🆔 <code>${orderNumber}</code>`,
            parse_mode: 'HTML'
          });
        }

      } else if (data.startsWith('rej_')) {
        // Reject receipt: rej_{order_number}
        const orderNumber = data.substring(4);
        pendingRejection[chatId] = { orderNumber };
        await tgRequest('sendMessage', {
          chat_id: chatId,
          text: `⚠️ <b>رفض الإيصال للطلب ${orderNumber}</b>\n\nاكتب سبب الرفض الآن وسيُرسل للعميل فوراً:`,
          parse_mode: 'HTML'
        });
      }
      return;
    }

    // ── 2. Handle Text Messages ──
    if (update.message && update.message.text) {
      const msg = update.message;
      const text = msg.text.trim();
      const chatId = msg.chat.id;

      // Check if admin is currently typing rejection reason
      if (pendingRejection[chatId] && !text.startsWith('/')) {
        const { orderNumber } = pendingRejection[chatId];
        delete pendingRejection[chatId];

        const { error: dbErr } = await supabase
          .from('orders')
          .update({ status: 'rejected', rejection_reason: text })
          .eq('order_number', orderNumber);

        if (dbErr) {
          await tgRequest('sendMessage', { chat_id: chatId, text: `❌ خطأ في الرفض: ${dbErr.message}` });
        } else {
          await tgRequest('sendMessage', {
            chat_id: chatId,
            text: `✅ <b>تم رفض الطلب</b> <code>${orderNumber}</code>\n📝 السبب: ${text}`,
            parse_mode: 'HTML'
          });
        }
        return;
      }

      if (text === '/start') {
        const helpText = `🔥 <b>أهلاً بك في بوت VEXIS Admin!</b> 🔥\n\n` +
          `الأوامر المتاحة:\n\n` +
          `🔹 /orders — أحدث 5 طلبات\n` +
          `🔹 /pending — الطلبات المعلقة\n` +
          `🔹 /status [رقم] [حالة] — تغيير حالة طلب\n\n` +
          `<i>الحالات: pending, review, shipped, delivered, rejected</i>`;
        await tgRequest('sendMessage', { chat_id: chatId, text: helpText, parse_mode: 'HTML' });

      } else if (text === '/orders' || text === '/pending') {
        let query = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(5);
        if (text === '/pending') query = query.eq('status', 'pending');
        const { data: orders } = await query;

        if (!orders || orders.length === 0) {
          await tgRequest('sendMessage', { chat_id: chatId, text: '📭 لا توجد طلبات.' });
        } else {
          for (const ord of orders) {
            const keyboard = {
              inline_keyboard: [
                [
                  { text: '✅ قبول (review)', callback_data: `st_${ord.order_number}_review` },
                  { text: '🚚 شحن (shipped)', callback_data: `st_${ord.order_number}_shipped` }
                ],
                [
                  { text: '🎉 تسليم (delivered)', callback_data: `st_${ord.order_number}_delivered` },
                  { text: '❌ رفض (rejected)', callback_data: `st_${ord.order_number}_rejected` }
                ]
              ]
            };
            await tgRequest('sendMessage', {
              chat_id: chatId,
              text: `🆔 <b>${ord.order_number}</b>\n👤 ${ord.customer_name} — ${ord.phone}\n📍 ${ord.governorate}\n💰 EGP ${ord.total}\n📌 <b>${ord.status}</b>`,
              parse_mode: 'HTML',
              reply_markup: keyboard
            });
          }
        }

      } else if (text.startsWith('/status ')) {
        const parts = text.split(' ');
        if (parts.length >= 3) {
          const orderNum = parts[1];
          const newStatus = parts[2].toLowerCase();
          const { error } = await supabase.from('orders').update({ status: newStatus }).eq('order_number', orderNum);
          if (error) {
            await tgRequest('sendMessage', { chat_id: chatId, text: '❌ خطأ: ' + error.message });
          } else {
            await tgRequest('sendMessage', { chat_id: chatId, text: `✅ تم تحديث الطلب ${orderNum} → ${newStatus}` });
          }
        } else {
          await tgRequest('sendMessage', { chat_id: chatId, text: '⚠️ الاستخدام: /status [رقم الطلب] [الحالة]' });
        }
      }
    }

  } catch (err) {
    console.error('[Telegram Webhook Error]', err);
  }
}

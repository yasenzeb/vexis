// api/_telegram-webhook.js — Telegram Bot Webhook endpoint
import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders } from './_auth.js';

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

    // ── 1. Handle Callback Queries (Button Clicks) ──
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || '';
      const chatId = cb.message?.chat?.id;

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
        let { error: dbErr } = await supabase
          .from('orders')
          .update({ status, rejection_reason: null })
          .eq('order_number', orderNumber);

        if (dbErr && dbErr.message && dbErr.message.includes('rejection_reason')) {
          const res = await supabase
            .from('orders')
            .update({ status })
            .eq('order_number', orderNumber);
          dbErr = res.error;
        }

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

        let { error: dbErr } = await supabase
          .from('orders')
          .update({ status: 'rejected', rejection_reason: text })
          .eq('order_number', orderNumber);

        if (dbErr && dbErr.message && dbErr.message.includes('rejection_reason')) {
          const res = await supabase
            .from('orders')
            .update({ status: 'rejected' })
            .eq('order_number', orderNumber);
          dbErr = res.error;
        }

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

      if (text === '/start' || text === '/help') {
        const helpText = `🔥 <b>أهلاً بك في نظام بوت VEXIS الذكي!</b> 🔥\n\n` +
          `<b>📊 أوامر التحليل والاستخراج:</b>\n` +
          `🔹 /stats — إحصائيات المبيعات والأرباح والطلبات\n` +
          `🔹 /today — ملخص طلبات اليوم وإجمالي الأرباح\n` +
          `🔹 /orders — أحدث 5 طلبات في المتجر\n` +
          `🔹 /pending — قائمة الطلبات المعلقة تنتظر الإجراء\n` +
          `🔹 /search [كلمة/رقم] — بحث شامل بالهاتف أو الاسم أو الرقم\n` +
          `🔹 /status [رقم] [حالة] — تغيير حالة طلب مباشر\n\n` +
          `<i>الحالات: pending, review, shipped, delivered, rejected</i>`;
        await tgRequest('sendMessage', { chat_id: chatId, text: helpText, parse_mode: 'HTML' });

      } else if (text === '/stats' || text === '/today') {
        let query = supabase.from('orders').select('*');
        if (text === '/today') {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          query = query.gte('created_at', todayStart.toISOString());
        }
        const { data: orders } = await query;
        const totalOrders = orders ? orders.length : 0;
        const totalRevenue = orders ? orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0) : 0;
        const pendingCount = orders ? orders.filter(o => o.status === 'pending').length : 0;
        const reviewCount = orders ? orders.filter(o => o.status === 'review').length : 0;
        const shippedCount = orders ? orders.filter(o => o.status === 'shipped').length : 0;
        const deliveredCount = orders ? orders.filter(o => o.status === 'delivered').length : 0;
        const rejectedCount = orders ? orders.filter(o => o.status === 'rejected').length : 0;

        const title = text === '/today' ? '📅 <b>تقرير مبيعات اليوم</b>' : '📊 <b>إحصائيات المبيعات الشاملة</b>';
        const statsMsg = `${title}\n\n` +
          `🔢 <b>إجمالي الطلبات:</b> ${totalOrders}\n` +
          `💰 <b>إجمالي الإيرادات:</b> EGP ${totalRevenue.toLocaleString()}\n\n` +
          `<b>توزيع الحالات:</b>\n` +
          `⏳ <b>معلق:</b> ${pendingCount}\n` +
          `🔍 <b>قيد المراجعة:</b> ${reviewCount}\n` +
          `🚚 <b>تم الشحن:</b> ${shippedCount}\n` +
          `🎉 <b>تم التسليم:</b> ${deliveredCount}\n` +
          `❌ <b>مرفوض:</b> ${rejectedCount}`;
        await tgRequest('sendMessage', { chat_id: chatId, text: statsMsg, parse_mode: 'HTML' });

      } else if (text.startsWith('/search ')) {
        const queryTerm = text.substring(8).trim();
        if (!queryTerm) {
          await tgRequest('sendMessage', { chat_id: chatId, text: '⚠️ يرجى إدخال كلمة البحث بعد /search' });
        } else {
          const { data: orders } = await supabase
            .from('orders')
            .select('*')
            .or(`order_number.ilike.%${queryTerm}%,customer_name.ilike.%${queryTerm}%,phone.ilike.%${queryTerm}%`)
            .limit(5);

          if (!orders || orders.length === 0) {
            await tgRequest('sendMessage', { chat_id: chatId, text: `📭 لم يتم العثور على أي نتائج لـ "${queryTerm}"` });
          } else {
            await tgRequest('sendMessage', { chat_id: chatId, text: `🔍 <b>نتائج البحث عثرت على ${orders.length} طلبات:</b>`, parse_mode: 'HTML' });
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
        }

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

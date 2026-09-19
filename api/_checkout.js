// api/checkout.js — إنشاء طلب جديد (يقبل نفس payload الـ PHP القديم)
import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders, isRateLimited, safeError } from './_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.APISUPABASE_SERVICE_ROLE_KEY
);

function generateOrderNumber() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VNT-${date}-${rand}`;
}

async function sendTelegram(message, replyMarkup = null) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const body = { chat_id: chatId, text: message, parse_mode: 'HTML' };
    if (replyMarkup) body.reply_markup = replyMarkup;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error('[Telegram]', e.message);
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Rate limit: 10 orders per IP per hour
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(`checkout:${ip}`, 10, 60 * 60 * 1000)) {
    return res.status(429).json({ success: false, error: 'محاولات كثيرة، حاول لاحقاً.' });
  }

  try {
    const body = req.body || {};

    // Accept both old PHP payload and new payload
    const firstName = (body.firstName || '').trim();
    const lastName  = (body.lastName  || '').trim();
    const name      = body.name ? body.name.trim() : `${firstName} ${lastName}`.trim();
    const phone     = (body.phone   || '').trim();
    const gov       = (body.city    || body.gov || '').trim();
    const address   = (body.address || '').trim();
    const notes     = (body.notes   || '').trim();
    const payment   = body.payment || 'cod';
    const items     = Array.isArray(body.items) ? body.items : [];
    const shipping  = Number(body.shipping || body.shippingCost || 0);
    const total     = Number(body.total || 0);

    if (!name || !phone || !gov || !address) {
      return res.status(400).json({ success: false, error: 'بيانات ناقصة' });
    }

    // Fetch cost prices of items from products table to snapshot them
    const { data: dbProducts } = await supabase
      .from('products')
      .select('id, cost_price');
    const costMap = {};
    if (dbProducts) {
      dbProducts.forEach(p => {
        costMap[p.id] = Number(p.cost_price || 0);
      });
    }

    const safeItems = items.map(item => {
      const itemId = String(item.id || '').substring(0, 100);
      return {
        id:         itemId,
        name:       String(item.name || '').substring(0, 200),
        price:      Number(item.price || item.finalPrice || 0),
        qty:        Math.max(1, Math.min(99, parseInt(item.qty) || 1)),
        size:       item.size  ? String(item.size).substring(0, 10)  : null,
        color:      item.color ? String(item.color).substring(0, 50) : null,
        finalPrice: Number(item.finalPrice || item.price || 0),
        cost_price: costMap[itemId] || 0
      };
    });

    const calcSubtotal   = safeItems.reduce((s, i) => s + i.finalPrice * i.qty, 0);
    const parsedShipping = Math.max(0, shipping);
    const parsedTotal    = total > 0 ? Math.round(total) : Math.round(calcSubtotal + parsedShipping);
    const orderNumber    = generateOrderNumber();

    const { data, error } = await supabase
      .from('orders')
      .insert([{
        order_number:  orderNumber,
        customer_name: name.substring(0, 100),
        phone:         phone.substring(0, 20),
        governorate:   gov.substring(0, 50),
        address:       address.substring(0, 500),
        notes:         notes ? notes.substring(0, 500) : null,
        payment_method: payment,
        items:         safeItems,
        subtotal:      calcSubtotal,
        shipping_cost: parsedShipping,
        total:         parsedTotal,
        status:        'pending',
      }])
      .select()
      .single();

    if (error) throw error;

    // Telegram notification (fire and forget)
    const itemsText = safeItems
      .map(i => `• ${i.name} [${i.size || 'N/A'}] ×${i.qty} = EGP ${i.finalPrice * i.qty}`)
      .join('\n');

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ مراجعة وموافقة (review)', callback_data: `st_${orderNumber}_review` },
          { text: '🚚 خرج للشحن (shipped)', callback_data: `st_${orderNumber}_shipped` }
        ],
        [
          { text: '🎉 تم التسليم (delivered)', callback_data: `st_${orderNumber}_delivered` },
          { text: '❌ رفض (rejected)', callback_data: `st_${orderNumber}_rejected` }
        ]
      ]
    };

    sendTelegram(
      `━━━━━━━━━━━━━━ 🛒 <b>طلب جديد!</b> ━━━━━━━━━━━━━━\n` +
      `🆔 <b>رقم الطلب:</b> <code>${orderNumber}</code>\n` +
      `👤 <b>العميل:</b> ${name}\n` +
      `📞 <b>الهاتف:</b> ${phone}\n` +
      `📍 <b>المحافظة:</b> ${gov}\n` +
      `🏠 <b>العنوان:</b> ${address}\n` +
      `💳 <b>طريقة الدفع:</b> ${payment}\n` +
      `📝 <b>ملاحظات:</b> ${notes || 'لا يوجد'}\n\n` +
      `📦 <b>المنتجات:</b>\n${itemsText}\n\n` +
      `💰 <b>المجموع:</b> EGP ${calcSubtotal}\n` +
      `🚚 <b>الشحن:</b> EGP ${parsedShipping}\n` +
      `✅ <b>الإجمالي:</b> EGP ${parsedTotal}`,
      inlineKeyboard
    );

    return res.status(201).json({
      success:      true,
      id:           data.id,
      order_number: data.order_number,
    });

  } catch (err) {
    console.error('[API /checkout]', err);
    return res.status(500).json({ success: false, error: safeError(err) });
  }
}

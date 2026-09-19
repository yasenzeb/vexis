// api/order.js — إنشاء طلب جديد مع إشعار Telegram
import { createClient } from '@supabase/supabase-js';
import { isRateLimited, safeError } from './_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── توليد رقم طلب فريد ──
function generateOrderNumber() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VNT-${date}-${rand}`;
}

// ── إرسال إشعار Telegram ──
async function sendTelegramNotification(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!token || !chatId) {
    console.error('[Telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });

    const result = await resp.json();
    if (!resp.ok) {
      console.error('[Telegram] Failed:', result);
      return false;
    }

    console.log('[Telegram] ✅ Sent successfully!');
    return true;
  } catch (e) {
    console.error('[Telegram] Error:', e.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// ⭐ MAIN HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, x-admin-password');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    try {
      const orderNumber = req.query.order_number || req.query.order;
      if (!orderNumber) {
        return res.status(400).json({ success: false, error: 'order_number required' });
      }
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('order_number', String(orderNumber).trim())
        .single();

      if (error || !data) {
        return res.status(404).json({ success: false, error: 'الطلب غير موجود' });
      }
      return res.status(200).json({ success: true, order: data });
    } catch (err) {
      return res.status(500).json({ success: false, error: safeError(err) });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: `Method ${req.method} not allowed.`,
    });
  }

  // ── Rate Limit ──
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown';
  
  if (isRateLimited(`order:${ip}`, 5, 60 * 60 * 1000)) {
    return res.status(429).json({ 
      success: false, 
      error: 'محاولات كثيرة، حاول لاحقاً.' 
    });
  }

  try {
    const {
      name, phone, gov, address, notes,
      payment, items, subtotal, shipping, total,
    } = req.body || {};

    // ── التحقق ──
    if (!name?.trim() || !phone?.trim() || !gov || !address?.trim() || !payment) {
      return res.status(400).json({ 
        success: false, 
        error: 'بيانات ناقصة'
      });
    }

    const allowedPayments = ['cod', 'vodafone_cash', 'instapay', 'transfer'];
    if (!allowedPayments.includes(payment)) {
      return res.status(400).json({ 
        success: false, 
        error: 'طريقة دفع غير مقبولة' 
      });
    }

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      return res.status(400).json({ 
        success: false, 
        error: 'السلة غير صالحة' 
      });
    }

    // ── تنظيف البيانات ──
    const safeItems = items.map(item => ({
      id:         String(item.id || '').substring(0, 100),
      name:       String(item.name || '').substring(0, 200),
      price:      Number(item.price) || 0,
      qty:        Math.max(1, Math.min(99, parseInt(item.qty) || 1)),
      size:       item.size ? String(item.size).substring(0, 10) : null,
      color:      item.color ? String(item.color).substring(0, 50) : null,
      finalPrice: Number(item.finalPrice) || Number(item.price) || 0,
    }));

    // ── حساب المجموع ──
    const calcSubtotal = safeItems.reduce((acc, i) => acc + i.finalPrice * i.qty, 0);
    const parsedShipping = Math.max(0, Number(shipping) || 0);
    const parsedTotal = Math.round(calcSubtotal + parsedShipping);

    const orderNumber = generateOrderNumber();

    // ── إدراج في Supabase ──
    const { data, error } = await supabase
      .from('orders')
      .insert([{
        order_number: orderNumber,
        customer_name: String(name).trim().substring(0, 100),
        phone: String(phone).trim().substring(0, 20),
        governorate: String(gov).trim().substring(0, 50),
        address: String(address).trim().substring(0, 500),
        notes: notes ? String(notes).trim().substring(0, 500) : null,
        payment_method: payment,
        items: safeItems,
        subtotal: calcSubtotal,
        shipping_cost: parsedShipping,
        total: parsedTotal,
        status: 'pending',
      }])
      .select()
      .single();

    if (error) {
      console.error('[API /order] DB Error:', error);
      throw error;
    }

    // ── Telegram Message ──
    let payLabel = 'الدفع عند الاستلام';
    if (payment === 'vodafone_cash') payLabel = 'فودافون كاش';
    else if (payment === 'instapay') payLabel = 'إنستا باي';
    else if (payment === 'transfer') payLabel = 'تحويل إلكتروني';

    const itemsText = safeItems
      .map(i => `• ${i.name} [المقاس: ${i.size || 'N/A'}] ×${i.qty} = EGP ${i.finalPrice * i.qty}`)
      .join('\n');

    const adminMessage = `━━━━━━━━━━━━━━ 🛒 طلب جديد ━━━━━━━━━━━━━━
🆔 رقم الطلب: ${orderNumber}
👤 العميل: ${name}
📞 الهاتف: ${phone}
📍 المحافظة: ${gov}
🏠 العنوان: ${address}
💳 طريقة الدفع: ${payLabel}
📝 ملاحظات: ${notes || 'لا يوجد'}

📦 المنتجات:
${itemsText}

💰 المجموع: EGP ${calcSubtotal}
🚚 الشحن: EGP ${parsedShipping}
✅ الإجمالي: EGP ${parsedTotal}`;

    // إرسال الإشعار للتليجرام
    sendTelegramNotification(adminMessage)
      .then(sent => console.log('[Telegram] Sent:', sent))
      .catch(err => console.error('[Telegram] Error:', err));

    // ── الرد ──
    return res.status(201).json({
      success: true,
      order: {
        order_number: data.order_number,
        id: data.id,
      },
    });

  } catch (err) {
    console.error('[API /order] 💥 ERROR:', err);
    return res.status(500).json({ 
      success: false, 
      error: safeError(err),
    });
  }
}
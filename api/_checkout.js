// api/_checkout.js — إنشاء طلب جديد
import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders, isRateLimited, safeError } from './_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.APISUPABASE_SERVICE_ROLE_KEY
);

const GOV_NAMES = {
  cairo: 'القاهرة',
  giza: 'الجيزة',
  alex: 'الإسكندرية',
  qalyubia: 'القليوبية',
  monufia: 'المنوفية',
  gharbia: 'الغربية',
  dakahlia: 'الدقهلية',
  sharqia: 'الشرقية',
  kafr_el_sheikh: 'كفر الشيخ',
  damietta: 'دمياط',
  beheira: 'البحيرة',
  ismailia: 'الإسماعيلية',
  port_said: 'بورسعيد',
  suez: 'السويس',
  fayoum: 'الفيوم',
  beni_suef: 'بني سويف',
  minya: 'المنيا',
  asyut: 'أسيوط',
  sohag: 'سوهاج',
  qena: 'قنا',
  luxor: 'الأقصر',
  aswan: 'أسوان',
  north_sinai: 'شمال سيناء',
  south_sinai: 'جنوب سيناء',
  red_sea: 'البحر الأحمر',
  matrouh: 'مطروح',
  new_valley: 'الوادي الجديد'
};

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
    const c = (typeof body.customer === 'object' && body.customer !== null) ? body.customer : {};

    // Customer Name (supports body.name, body.customer.name, or firstName + lastName)
    const firstName = (body.firstName || c.firstName || '').trim();
    const lastName  = (body.lastName  || c.lastName  || '').trim();
    let name = (body.name || c.name || '').trim();
    if (!name && (firstName || lastName)) {
      name = `${firstName} ${lastName}`.trim();
    }

    // Phone
    const phone = (body.phone || c.phone || '').trim();

    // Governorate
    const rawGov = (body.governorate || body.city || body.gov || c.governorate || c.city || c.gov || '').trim();
    const gov = GOV_NAMES[rawGov.toLowerCase()] || rawGov;

    // Address
    const address = (body.address || c.address || '').trim();

    // Notes
    const notes = (body.notes || c.notes || '').trim();

    // Payment method
    const payment = (body.payment || body.payment_method || c.payment || c.payment_method || 'cod').toLowerCase();

    // Items array (supports items or cart)
    const items = Array.isArray(body.items) ? body.items : (Array.isArray(body.cart) ? body.cart : (Array.isArray(c.items) ? c.items : []));

    // Financials
    const shipping = Number(body.shipping ?? body.shippingCost ?? c.shipping ?? 0);
    const discount = Number(body.discount ?? c.discount ?? 0);
    const total    = Number(body.total ?? body.finalTotal ?? c.total ?? 0);

    if (!name) {
      return res.status(400).json({ success: false, error: 'برجاء كتابة الاسم بالكامل' });
    }
    if (!phone) {
      return res.status(400).json({ success: false, error: 'برجاء إدخال رقم الهاتف' });
    }
    if (!rawGov) {
      return res.status(400).json({ success: false, error: 'برجاء اختيار المحافظة' });
    }
    if (!address) {
      return res.status(400).json({ success: false, error: 'برجاء كتابة العنوان بالتفصيل' });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, error: 'سلة المشتريات فارغة' });
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
        name:       String(item.name || item.title || '').substring(0, 200),
        price:      Number(item.price || item.finalPrice || 0),
        qty:        Math.max(1, Math.min(99, parseInt(item.qty || item.quantity) || 1)),
        size:       item.size  ? String(item.size).substring(0, 10)  : null,
        color:      item.color ? String(item.color).substring(0, 50) : null,
        finalPrice: Number(item.finalPrice || item.price || 0),
        cost_price: costMap[itemId] || 0
      };
    });

    const calcSubtotal   = safeItems.reduce((s, i) => s + i.finalPrice * i.qty, 0);
    const parsedShipping = Math.max(0, shipping);
    const parsedDiscount = Math.max(0, discount);
    const parsedTotal    = total > 0 ? Math.round(total) : Math.max(0, Math.round(calcSubtotal - parsedDiscount + parsedShipping));
    const orderNumber    = generateOrderNumber();

    const { data, error } = await supabase
      .from('orders')
      .insert([{
        order_number:   orderNumber,
        customer_name:  name.substring(0, 100),
        phone:          phone.substring(0, 20),
        governorate:    gov.substring(0, 50),
        address:        address.substring(0, 500),
        notes:          notes ? notes.substring(0, 500) : null,
        payment_method: payment,
        items:          safeItems,
        subtotal:       calcSubtotal,
        shipping_cost:  parsedShipping,
        total:          parsedTotal,
        status:         'pending',
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

    const discountLine = parsedDiscount > 0 ? `🏷️ <b>الخصم:</b> -EGP ${parsedDiscount}\n` : '';

    sendTelegram(
      `━━━━━━━━━━━━━━ 🛒 <b>طلب جديد!</b> ━━━━━━━━━━━━━━\n` +
      `🆔 <b>رقم الطلب:</b> <code>${orderNumber}</code>\n` +
      `👤 <b>العميل:</b> ${name}\n` +
      `📞 <b>الهاتف:</b> ${phone}\n` +
      `📍 <b>المحافظة:</b> ${gov}\n` +
      `🏠 <b>العنوان:</b> ${address}\n` +
      `💳 <b>طريقة الدفع:</b> ${payment === 'cod' ? 'الدفع عند الاستلام (COD)' : payment}\n` +
      `📝 <b>ملاحظات:</b> ${notes || 'لا يوجد'}\n\n` +
      `📦 <b>المنتجات:</b>\n${itemsText}\n\n` +
      `💰 <b>المجموع:</b> EGP ${calcSubtotal}\n` +
      discountLine +
      `🚚 <b>الشحن:</b> EGP ${parsedShipping}\n` +
      `✅ <b>الإجمالي المطلوب:</b> EGP ${parsedTotal}`,
      inlineKeyboard
    );

    // Check total tax threshold on every new order (3 EGP tax / order)
    try {
      const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true });
      const currentTax = (count || 0) * 3;
      if (currentTax >= 100) {
        const waUrl = `https://wa.me/201061927815?text=${encodeURIComponent(`مرحباً، أود سداد الضريبة المستحقة قدرها ${currentTax} ج.م الخاصة بمتجر VEXIS.`)}`;
        sendTelegram(
          `🚨 <b>تنبيه عاجل: تجاوزت قيمة الضريبة المستحقة 100 ج.م!</b> 🚨\n\n` +
          `إجمالي عدد الطلبات: <b>${count}</b> طلبات\n` +
          `إجمالي الضريبة المستحقة: <b>${currentTax} ج.م</b>\n\n` +
          `اضغط على زر "ادفع الآن" لفتح الواتساب وسداد المستحق مباشرة.`,
          {
            inline_keyboard: [
              [{ text: `💳 ادفع الآن (${currentTax} ج.م)`, url: waUrl }]
            ]
          }
        );
      }
    } catch (taxErr) {
      console.error('[Tax Threshold Check Error]', taxErr);
    }

    return res.status(201).json({
      success:      true,
      id:           data.id,
      order_id:     data.order_number,
      order_number: data.order_number,
    });

  } catch (err) {
    console.error('[API /checkout]', err);
    return res.status(500).json({ success: false, error: safeError(err) });
  }
}

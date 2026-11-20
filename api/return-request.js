import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders } from './_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.APISUPABASE_SERVICE_ROLE_KEY
);

async function tgRequest(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await r.json();
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, order_number, reason } = req.body || {};
  if (!phone) return res.status(400).json({ success: false, error: 'Phone number is required' });

  const rawPhone = String(phone).replace(/\D/g, '');
  const cleanPhone = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone;

  let query = supabase
    .from('orders')
    .select('order_number, created_at, customer_name, phone, status, total, items')
    .order('created_at', { ascending: false })
    .limit(100);

  if (order_number) {
    query = query.ilike('order_number', `%${order_number.trim()}%`);
  }

  const { data: orders, error } = await query;
  if (error) return res.status(500).json({ success: false, error: error.message });

  // Flexible phone matching
  const matchingOrders = (orders || []).filter(ord => {
    if (!ord.phone) return false;
    const p = String(ord.phone).replace(/\D/g, '');
    if (p === rawPhone) return true;
    if (cleanPhone && cleanPhone.length >= 8 && p.endsWith(cleanPhone)) return true;
    return false;
  });

  if (!matchingOrders || matchingOrders.length === 0) {
    return res.status(404).json({ success: false, error: 'No orders found matching this phone number.' });
  }

  const order = matchingOrders[0];
  const orderDate = new Date(order.created_at);
  const now = Date.now();
  const daysDiff = (now - orderDate.getTime()) / (1000 * 60 * 60 * 24);

  if (daysDiff > 14) {
    return res.json({
      success: false,
      expired: true,
      error: 'Return period has expired. Orders can only be returned within 14 days of purchase.',
      order_number: order.order_number,
      days_since_order: Math.floor(daysDiff)
    });
  }

  // Send Telegram notification to admin
  const adminChatId = process.env.TELEGRAM_CHAT_ID || '7242279880';
  await tgRequest('sendMessage', {
    chat_id: adminChatId,
    text: `🔄 <b>طلب استرجاع / استبدال جديد (Return & Exchange)</b>\n\n` +
          `📦 <b>رقم الطلب:</b> <code>${order.order_number}</code>\n` +
          `👤 <b>العميل:</b> ${order.customer_name || 'N/A'}\n` +
          `📞 <b>الهاتف:</b> <code>${order.phone || phone}</code>\n` +
          `💰 <b>إجمالي الطلب:</b> EGP ${order.total}\n` +
          `📅 <b>تاريخ الطلب:</b> ${orderDate.toLocaleDateString('en-US')} (${Math.floor(daysDiff)} days ago)\n` +
          `📝 <b>السبب:</b> ${reason || 'Not specified'}\n\n` +
          `⚡ <i>الطلب ساري ومطابق لشرط الـ 14 يوماً</i>`,
    parse_mode: 'HTML'
  });

  // Send WhatsApp confirmation to customer (fire and forget)
  if (process.env.WA_SERVICE_URL && process.env.WA_API_SECRET && (order.phone || phone)) {
    fetch(`${process.env.WA_SERVICE_URL}/send-return`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': process.env.WA_API_SECRET,
      },
      body: JSON.stringify({
        phone:        order.phone || phone,
        customerName: order.customer_name || 'عميلنا العزيز',
        orderNumber:  order.order_number
      }),
      signal: AbortSignal.timeout(6000),
    }).catch(err => console.warn('[WA Return Confirmation]', err.message));
  }

  return res.json({
    success: true,
    order_number: order.order_number,
    days_since_order: Math.floor(daysDiff)
  });
}

// api/_orders-by-phone.js — جلب طلبات عميل بناءً على رقم هاتفه
import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders, safeError } from './_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const phone = req.query.phone || '';
    if (!phone || phone.length < 7) {
      return res.status(400).json({ success: false, error: 'رقم الهاتف مطلوب' });
    }

    const rawPhone = String(phone).replace(/\D/g, '');
    const cleanPhone = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone;

    const { data, error } = await supabase
      .from('orders')
      .select('order_number, customer_name, phone, governorate, status, shipping_cost, total, created_at, items')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    // Filter matching phone numbers flexibly (handle country code differences like +20, 010..., etc)
    const filteredOrders = (data || []).filter(ord => {
      if (!ord.phone) return false;
      const p = String(ord.phone).replace(/\D/g, '');
      if (p === rawPhone) return true;
      if (cleanPhone && cleanPhone.length >= 8 && p.endsWith(cleanPhone)) return true;
      return false;
    });

    return res.status(200).json({ success: true, orders: filteredOrders });
  } catch (err) {
    console.error('[API /orders-by-phone]', err);
    return res.status(500).json({ success: false, error: safeError(err) });
  }
}

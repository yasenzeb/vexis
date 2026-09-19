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

    const { data, error } = await supabase
      .from('orders')
      .select('order_number, customer_name, phone, governorate, status, shipping_cost, total, created_at, receipt_url, items, rejection_reason')
      .eq('phone', String(phone).trim())
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    return res.status(200).json({ success: true, orders: data || [] });
  } catch (err) {
    console.error('[API /orders-by-phone]', err);
    return res.status(500).json({ success: false, error: safeError(err) });
  }
}

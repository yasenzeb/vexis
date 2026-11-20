import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders, requireAdmin, safeError } from './_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.APISUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!requireAdmin(req)) {
    return res.status(401).json({ success: false, error: 'غير مصرح.' });
  }

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ success: true, orders: data || [] });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ success: false, error: 'id مطلوب.' });
      }

      const { error } = await supabase
        .from('orders')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return res.status(200).json({ success: true, message: 'تم حذف الطلب.' });
    }

    if (req.method === 'PUT') {
      const { id }     = req.query;
      const { status } = req.body || {};
      const allowed    = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

      if (!id || !status || !allowed.includes(status)) {
        return res.status(400).json({ success: false, error: 'بيانات غير صالحة.' });
      }

      const { data, error } = await supabase
        .from('orders')
        .update({ status })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // WhatsApp status notification (fire and forget)
      if (process.env.WA_SERVICE_URL && process.env.WA_API_SECRET && (status === 'shipped' || status === 'delivered')) {
        fetch(`${process.env.WA_SERVICE_URL}/send-status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-secret': process.env.WA_API_SECRET,
          },
          body: JSON.stringify({
            phone:        data.phone,
            customerName: data.customer_name,
            orderNumber:  data.order_number,
            status:       status
          }),
          signal: AbortSignal.timeout(6000),
        }).catch(err => console.warn('[WA Status]', err.message));
      }

      return res.status(200).json({ success: true, order: data });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    console.error('[API /orders]', err);
    return res.status(500).json({ success: false, error: safeError(err) });
  }
}
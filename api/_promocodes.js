import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders, requireAdmin, safeError } from './_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.APISUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // 1. PUBLIC VALIDATION (GET with ?code=... OR POST with { code })
    const queryCode = req.query?.code;
    const bodyCode = req.body?.code;
    const lookupCode = queryCode || (req.method === 'POST' ? bodyCode : null);

    if (lookupCode) {
      const cleanCode = String(lookupCode).trim().toUpperCase();
      if (!cleanCode) {
        return res.status(400).json({ success: false, error: 'Promo code is required' });
      }

      const { data, error } = await supabase
        .from('promocodes')
        .select('*')
        .ilike('code', cleanCode)
        .single();

      if (error || !data) {
        return res.status(404).json({ success: false, error: 'كود الخصم غير صحيح (Invalid promo code)' });
      }

      if (data.is_active === false) {
        return res.status(400).json({ success: false, error: 'هذا الكود غير مفعّل حالياً (Inactive promo code)' });
      }

      if (data.expiry_date && new Date(data.expiry_date) < new Date()) {
        return res.status(400).json({ success: false, error: 'هذا الكود منتهي الصلاحية (Expired promo code)' });
      }

      const promoPayload = {
        code: data.code,
        discount_type: data.discount_type || 'percent',
        discount_value: Number(data.discount_value),
        min_spend: Number(data.min_spend || 0)
      };

      return res.status(200).json({
        success: true,
        promo: promoPayload,
        promocode: promoPayload
      });
    }

    // 2. ADMIN: List all promo codes (GET without code)
    if (req.method === 'GET') {
      if (!requireAdmin(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { data, error } = await supabase
        .from('promocodes')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        return res.status(200).json({ success: true, promocodes: [] });
      }

      return res.status(200).json({ success: true, promocodes: data || [] });
    }

    // 3. ADMIN: Create or Update promo code (PUT)
    if (req.method === 'PUT') {
      if (!requireAdmin(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { code, discount_type, discount_value, min_spend, is_active } = req.body || {};
      if (!code || !discount_value) {
        return res.status(400).json({ success: false, error: 'Code and discount_value are required' });
      }

      const cleanCode = String(code).trim().toUpperCase();

      const { data, error } = await supabase
        .from('promocodes')
        .upsert([{
          code: cleanCode,
          discount_type: discount_type || 'percent',
          discount_value: Number(discount_value),
          min_spend: Number(min_spend || 0),
          is_active: is_active !== undefined ? Boolean(is_active) : true,
          updated_at: new Date().toISOString()
        }], { onConflict: 'code' })
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ success: true, promocode: data });
    }

    // 4. ADMIN: Delete promo code (DELETE)
    if (req.method === 'DELETE') {
      if (!requireAdmin(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const codeToDelete = req.query?.code || req.body?.code;
      if (!codeToDelete) {
        return res.status(400).json({ success: false, error: 'Code is required' });
      }

      const { error } = await supabase
        .from('promocodes')
        .delete()
        .eq('code', String(codeToDelete).trim().toUpperCase());

      if (error) throw error;
      return res.status(200).json({ success: true, message: 'Promo code deleted' });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    console.error('[API /promocodes]', err);
    return res.status(500).json({ success: false, error: safeError(err) });
  }
}

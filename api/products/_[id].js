import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders, requireAdmin, safeError } from '../_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.APISUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_URL_PATTERNS = [
  /^https:\/\/res\.cloudinary\.com\//,
  /^https:\/\/[a-zA-Z0-9-]+\.supabase\.co\/storage\//
];

function isAllowedUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return ALLOWED_URL_PATTERNS.some(pattern => pattern.test(url));
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ success: false, error: 'Product ID is required.' });
  }

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, error: 'Product not found.' });

      const product = {
        ...data,
        cost_price:       Number(data.cost_price || 0),
        discount_type:    data.discount_type  || 'none',
        discount_value:   data.discount_value || 0,
        sizes:            Array.isArray(data.sizes) && data.sizes.length ? data.sizes : [38,39,40,41,42,43,44,45],
        colors:           Array.isArray(data.colors) ? data.colors : [],
        gallery:          Array.isArray(data.gallery) ? data.gallery : [],
        main_image_index: data.main_image_index || 0,
        is_out_of_stock:  Boolean(data.is_out_of_stock)
      };

      return res.status(200).json({ success: true, product });
    }

    if (req.method === 'PUT') {
      if (!requireAdmin(req)) {
        return res.status(401).json({ success: false, error: 'غير مصرح.' });
      }

      const { name, type, price, cost_price, image_url, discount_type, discount_value, sizes, colors, gallery, main_image_index, is_out_of_stock } = req.body || {};
      const updates = {};

      if (name !== undefined) updates.name = name;
      if (type !== undefined) updates.type = type;
      if (price !== undefined) updates.price = parseInt(price);
      if (cost_price !== undefined) updates.cost_price = parseInt(cost_price);
      if (image_url !== undefined) updates.image_url = image_url;
      if (is_out_of_stock !== undefined) updates.is_out_of_stock = Boolean(is_out_of_stock);

      if (discount_type !== undefined) updates.discount_type = discount_type;
      if (discount_value !== undefined) {
        updates.discount_value = discount_type === 'none' ? 0 : (parseFloat(discount_value) || 0);
      }

      if (sizes !== undefined) updates.sizes = Array.isArray(sizes) && sizes.length ? sizes : [38,39,40,41,42,43,44,45];
      if (colors !== undefined) updates.colors = Array.isArray(colors) ? colors : [];
      if (gallery !== undefined) updates.gallery = Array.isArray(gallery) ? gallery : [];
      if (main_image_index !== undefined) updates.main_image_index = parseInt(main_image_index) || 0;

      if (updates.discount_type === 'none') {
        updates.discount_value = 0;
      }

      if (type !== undefined) {
        const { data: catData, error: catError } = await supabase
          .from('categories')
          .select('slug')
          .eq('slug', type)
          .single();

        if (catError || !catData) {
          return res.status(400).json({ success: false, error: 'الفئة غير موجودة' });
        }
      }

      if (image_url !== undefined && image_url && !isAllowedUrl(image_url)) {
        return res.status(400).json({ success: false, error: 'رابط الصورة غير مسموح به' });
      }

      if (gallery !== undefined && Array.isArray(gallery)) {
        for (const url of gallery) {
          if (url && !isAllowedUrl(url)) {
            return res.status(400).json({ success: false, error: 'رابط غير مسموح به في المعرض' });
          }
        }
      }

      let { data, error } = await supabase
        .from('products')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error && error.message && error.message.includes('is_out_of_stock')) {
        delete updates.is_out_of_stock;
        const retry = await supabase
          .from('products')
          .update(updates)
          .eq('id', id)
          .select()
          .single();
        if (retry.error) throw retry.error;
        data = retry.data;
      } else if (error) {
        throw error;
      }

      return res.status(200).json({ success: true, product: data });
    }

    if (req.method === 'DELETE') {
      if (!requireAdmin(req)) {
        return res.status(401).json({ success: false, error: 'غير مصرح.' });
      }

      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return res.status(200).json({ success: true, message: 'Product deleted.' });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    console.error(`[API /products/${id}]`, err);
    return res.status(500).json({ success: false, error: err.message || 'حدث خطأ داخلي.' });
  }
}
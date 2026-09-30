import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders, requireAdmin, safeError } from './_auth.js';

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

  try {
    if (req.method === 'GET') {
      const { type } = req.query;
      let query = supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

      if (type && type !== 'all') {
        query = query.eq('type', type);
      }

      const { data, error } = await query;
      if (error) throw error;

      const products = (data || []).map(p => ({
        ...p,
        cost_price:       Number(p.cost_price || 0),
        discount_type:    p.discount_type  || 'none',
        discount_value:   p.discount_value || 0,
        sizes:            Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ['S','M','L','XL','XXL'],
        colors:           Array.isArray(p.colors) ? p.colors : [],
        gallery:          Array.isArray(p.gallery) ? p.gallery : [],
        main_image_index: p.main_image_index || 0
      }));

      return res.status(200).json({ success: true, products });
    }

    if (req.method === 'POST') {
      if (!requireAdmin(req)) {
        return res.status(401).json({ success: false, error: 'غير مصرح.' });
      }

      const { name, type, price, cost_price, description, image_url, discount_type, discount_value, sizes, colors, gallery, main_image_index, hover_image_index } = req.body || {};

      if (!name || !type || !price) {
        return res.status(400).json({ success: false, error: 'name, type, and price are required.' });
      }

      const { data: catData, error: catError } = await supabase
        .from('categories')
        .select('slug')
        .eq('slug', type)
        .single();

      if (catError || !catData) {
        return res.status(400).json({ success: false, error: 'Category does not exist' });
      }

      const parsedDiscountValue = discount_type === 'none'
        ? 0
        : (parseFloat(discount_value) || 0);

      if (image_url && !isAllowedUrl(image_url)) {
        return res.status(400).json({ success: false, error: 'Invalid image URL' });
      }

      if (Array.isArray(gallery)) {
        for (const url of gallery) {
          if (url && !isAllowedUrl(url)) {
            return res.status(400).json({ success: false, error: 'Invalid gallery URL' });
          }
        }
      }

      const { data, error } = await supabase
        .from('products')
        .insert([{
          name,
          type,
          price: parseInt(price),
          cost_price: parseInt(cost_price) || 0,
          description: description || null,
          image_url: image_url || null,
          discount_type: discount_type || 'none',
          discount_value: parsedDiscountValue,
          sizes: Array.isArray(sizes) && sizes.length ? sizes : ['S','M','L','XL','XXL'],
          colors: Array.isArray(colors) ? colors : [],
          gallery: Array.isArray(gallery) ? gallery : [],
          main_image_index: parseInt(main_image_index) || 0
        }])
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ success: true, product: data });
    }

    if (req.method === 'PUT') {
      if (!requireAdmin(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized.' });
      }

      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ success: false, error: 'Product ID is required.' });
      }

      const { name, type, price, cost_price, description, image_url, discount_type, discount_value, sizes, colors, gallery, main_image_index } = req.body || {};
      const updates = {};

      if (name !== undefined) updates.name = name;
      if (type !== undefined) updates.type = type;
      if (price !== undefined) updates.price = parseInt(price);
      if (cost_price !== undefined) updates.cost_price = parseInt(cost_price);
      if (description !== undefined) updates.description = description;
      if (image_url !== undefined) updates.image_url = image_url;

      if (discount_type !== undefined) updates.discount_type = discount_type;
      if (discount_value !== undefined) {
        updates.discount_value = discount_type === 'none' ? 0 : (parseFloat(discount_value) || 0);
      }

      if (sizes !== undefined) updates.sizes = Array.isArray(sizes) && sizes.length ? sizes : ['S','M','L','XL','XXL'];
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

      const { data, error } = await supabase
        .from('products')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ success: true, product: data });
    }

    if (req.method === 'DELETE') {
      if (!requireAdmin(req)) {
        return res.status(401).json({ success: false, error: 'غير مصرح.' });
      }

      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ success: false, error: 'Product ID is required.' });
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
    console.error('[API /products]', err);
    return res.status(500).json({ success: false, error: err.message || 'حدث خطأ داخلي.' });
  }
}
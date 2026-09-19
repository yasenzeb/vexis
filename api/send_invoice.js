// api/send_invoice.js — إرسال الفاتورة بالبريد الإلكتروني عبر Brevo (Sendinblue)
import { setCorsHeaders, isRateLimited } from './_auth.js';
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(`invoice:${ip}`, 10, 60 * 60 * 1000)) {
    return res.status(429).json({ success: false, error: 'محاولات كثيرة.' });
  }

  try {
    const body = req.body || {};
    const { email, customer_name, order_number, phone, address, city, shipping_cost, total } = body;

    if (!email || !customer_name) {
      return res.status(400).json({ success: false, error: 'email و customer_name مطلوبان' });
    }

    const brevoKey = process.env.BREVO_API_KEY;
    if (!brevoKey) {
      return res.status(500).json({
        success: false,
        error: 'مفتاح Brevo API غير مضبوط. أضف BREVO_API_KEY في Vercel Environment Variables.'
      });
    }

    // 1. Reconstruct items from arrays
    const products = body.products || [];
    const sizes = body.sizes || [];
    const colors = body.colors || [];
    const quantities = body.quantities || [];
    const images = body.images || [];
    const prices = body.prices || [];

    const items = products.map((name, i) => {
      const price = Number(prices[i]) || 0;
      const qty = Number(quantities[i]) || 1;
      return {
        name,
        size: sizes[i] || 'N/A',
        color: colors[i] || 'N/A',
        qty,
        price,
        image: images[i] || '',
        line_total: price * qty
      };
    });

    // 2. Read and parse invoice.html template
    const invoiceTemplatePath = path.join(process.cwd(), 'invoice.html');
    if (!fs.existsSync(invoiceTemplatePath)) {
      throw new Error('ملف الفاتورة invoice.html غير موجود على الخادم');
    }
    let htmlContent = fs.readFileSync(invoiceTemplatePath, 'utf8');

    const govNames = {
      'cairo': 'القاهرة / الجيزة',
      'alex': 'الإسكندرية',
      'delta': 'الدلتا والقناة',
      'upper': 'الصعيد والبحر الأحمر'
    };
    const city_display = govNames[city] || city || '';

    // Render products table
    const loopRegex = /\{%\s*for\s+item\s+in\s+items\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/;
    const loopMatch = htmlContent.match(loopRegex);
    let itemsHtml = '';
    if (loopMatch) {
      const templateRow = loopMatch[1];
      items.forEach(item => {
        let rowHtml = templateRow
          .replace(/\{\{\s*item\.image\s*\}\}/g, item.image || 'https://placehold.co/60x60/111/eab308?text=Vexis')
          .replace(/\{\{\s*item\.name\s*\}\}/g, item.name)
          .replace(/\{\{\s*item\.color\s*\}\}/g, item.color)
          .replace(/\{\{\s*item\.size\s*\}\}/g, item.size)
          .replace(/\{\{\s*item\.qty\s*\}\}/g, item.qty)
          .replace(/\{\{\s*item\.price\s*\}\}/g, item.price)
          .replace(/\{\{\s*item\.line_total\s*\}\}/g, item.line_total);
        itemsHtml += rowHtml;
      });
      htmlContent = htmlContent.replace(loopRegex, itemsHtml);
    }

    const invoice_number = 'INV-' + (order_number ? order_number.split('-').pop() : Math.floor(Math.random() * 100000));
    const dateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
    const subtotal = Number(total || 0) - Number(shipping_cost || 0);

    htmlContent = htmlContent
      .replace(/\{\{\s*invoice_number\s*\}\}/g, invoice_number)
      .replace(/\{\{\s*date\s*\}\}/g, dateStr)
      .replace(/\{\{\s*order_number\s*\}\}/g, order_number || '')
      .replace(/\{\{\s*customer_name\s*\}\}/g, customer_name || '')
      .replace(/\{\{\s*address\s*\}\}/g, address || '')
      .replace(/\{\{\s*city_display\s*\}\}/g, city_display)
      .replace(/\{\{\s*phone\s*\}\}/g, phone || '')
      .replace(/\{\{\s*email\s*\}\}/g, email || '')
      .replace(/\{\{\s*subtotal\s*\}\}/g, subtotal)
      .replace(/\{\{\s*shipping_cost\s*\}\}/g, shipping_cost || 0)
      .replace(/\{\{\s*total\s*\}\}/g, total || 0);

    // 3. Send via Brevo API (no npm package needed — just fetch)
    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'oovexis26@gmail.com';
    const senderName = process.env.BREVO_SENDER_NAME || 'Vexis Store';

    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: email, name: customer_name }],
        subject: `VEXIS - فاتورة وتأكيد الطلب #${order_number || ''}`,
        htmlContent: htmlContent
      })
    });

    const brevoData = await brevoResponse.json();

    if (!brevoResponse.ok) {
      console.error('[Brevo Error]', brevoData);
      throw new Error(brevoData.message || 'فشل إرسال البريد الإلكتروني عبر Brevo');
    }

    console.log(`[send_invoice] ✅ Email sent to ${email} for order ${order_number}`, brevoData);
    return res.status(200).json({ success: true, messageId: brevoData.messageId });

  } catch (err) {
    console.error('[API /send_invoice]', err);
    return res.status(500).json({ success: false, error: err.message || 'حدث خطأ داخلي.' });
  }
}

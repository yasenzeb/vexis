// api/_whatsapp-admin.js — WhatsApp Admin Bot Control System for 01001982117
import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders } from './_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.APISUPABASE_SERVICE_ROLE_KEY
);

const WA_API_SECRET = process.env.WA_API_SECRET || 'vexis-wa-2024-secret';
const WA_SERVICE_URL = process.env.WA_SERVICE_URL || 'https://vexis-whatsapp-service.onrender.com';
const ADMIN_PHONE = '201001982117';

// Helper to notify customer via WhatsApp when status changes to shipped/delivered
async function notifyCustomerStatus(phone, customerName, orderNumber, status) {
  if (!WA_SERVICE_URL || !phone) return;
  try {
    await fetch(`${WA_SERVICE_URL}/send-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': WA_API_SECRET,
      },
      body: JSON.stringify({ phone, customerName, orderNumber, status }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    console.warn('[WA Status Notify Error]', err.message);
  }
}

// Helper to send a direct WhatsApp message to any customer
async function sendDirectWAMessage(phone, text) {
  if (!WA_SERVICE_URL || !phone || !text) return false;
  try {
    const res = await fetch(`${WA_SERVICE_URL}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': WA_API_SECRET,
      },
      body: JSON.stringify({ phone, message: text }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await res.json();
    return d.success;
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // 1. Verify API Secret
  const secret = req.headers['x-api-secret'] || req.query.secret;
  if (secret !== WA_API_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized secret' });
  }

  const { from, message } = req.body || {};
  const cleanFrom = (from || '').toString().replace(/\D/g, '');

  // 2. Verify Admin Phone (01001982117)
  if (!cleanFrom.endsWith('1001982117')) {
    return res.status(403).json({ success: false, error: 'Forbidden: sender is not admin' });
  }

  const text = (message || '').trim();
  if (!text) {
    return res.json({ success: true, reply: '⚠️ لم يتم استلام أي نص.' });
  }

  const parts = text.split(/\s+/);
  const firstWord = parts[0].toLowerCase();

  try {
    // ── Command 1: Help & Menu ────────────────────────────────
    if (['/start', '/help', 'مساعدة', 'اوامر', 'أوامر', 'منيو', 'قائمة'].includes(firstWord)) {
      const reply = `👑 *لوحة تحكم إدارة VEXIS على واتساب* 🏋️🔥

*📊 أوامر التحليل والمبيعات:*
• \`احصائيات\` أو \`/stats\` — إجمالي الأرباح، الشحن، الضرائب وتوزيع الحالات
• \`اليوم\` أو \`/today\` — مبيعات وطلبات اليوم

*📦 أوامر الطلبات:*
• \`طلبات\` أو \`/orders\` — أحدث 5 طلبات مسجلة
• \`معلق\` أو \`/pending\` — الطلبات المعلقة في انتظار الإجراء
• \`بحث [رقم/هاتف/اسم]\` — بحث شامل في الطلبات

*⚡ أوامر سريعة لتحديث حالة أي طلب:*
• \`قبول [رقم الطلب]\` — تأكيد الأوردر ومراجعته
• \`شحن [رقم الطلب]\` — تحويل لـ "خرج للشحن" + إشعار العميل برابط التتبع
• \`تسليم [رقم الطلب]\` — تحويل لـ "تم التسليم" + إشعار العميل بالضمان
• \`رفض [رقم الطلب] [السبب]\` — رفض الطلب وتسجيل السبب

*🏷️ إدارة أكواد الخصم والمنتجات:*
• \`اكواد\` — عرض كل أكواد الخصم النشطة
• \`كود [الاسم] [النسبة%]\` — إنشاء كود خصم جديد (مثال: \`كود VEXIS15 15\`)
• \`منتجات\` — عرض قائمة المنتجات المتوفرة

*💬 مراسلة عميل:*
• \`رسالة [رقم الهاتف] [النص]\` — إرسال واتساب مباشر لأي عميل`;

      return res.json({ success: true, reply });
    }

    // ── Command 2: Stats & Today ──────────────────────────────
    if (['/stats', '/today', 'احصائيات', 'إحصائيات', 'أرباح', 'ارباح', 'اليوم', 'مبيعات اليوم'].includes(firstWord)) {
      const isToday = ['/today', 'اليوم', 'مبيعات اليوم'].includes(firstWord);

      let query = supabase.from('orders').select('*');
      if (isToday) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        query = query.gte('created_at', todayStart.toISOString());
      }

      const { data: orders, error } = await query;
      if (error) throw error;

      const all = orders || [];
      const totalOrders = all.length;
      const shippedOrDelivered = all.filter(o => o.status === 'shipped' || o.status === 'delivered');
      const revenue = shippedOrDelivered.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
      const totalTax = totalOrders * 3; // 3 EGP per order

      const pendingCount   = all.filter(o => o.status === 'pending').length;
      const reviewCount    = all.filter(o => o.status === 'review' || o.status === 'confirmed').length;
      const shippedCount   = all.filter(o => o.status === 'shipped').length;
      const deliveredCount = all.filter(o => o.status === 'delivered').length;
      const rejectedCount  = all.filter(o => o.status === 'rejected' || o.status === 'cancelled').length;

      const title = isToday ? '📅 *تقرير مبيعات وطلبات اليوم*' : '📊 *إحصائيات متجر VEXIS العامة*';

      let reply = `${title} 🏋️

🔢 *إجمالي عدد الطلبات:* ${totalOrders} طلب
💵 *إيرادات الشحن والتسليم:* *EGP ${revenue.toLocaleString()}*
🧾 *الضريبة المستحقة (3 ج/طلب):* EGP ${totalTax}

━━━━━━━━━━━━━━━━━━━
📌 *توزيع الحالات:*
⏳ *معلق:* ${pendingCount}
🔍 *قيد المراجعة:* ${reviewCount}
🚚 *خرج للشحن:* ${shippedCount}
🎉 *تم التسليم:* ${deliveredCount}
❌ *مرفوض/ملغي:* ${rejectedCount}`;

      if (totalTax >= 100) {
        reply += `\n\n⚠️ *تنبيه:* قيمة الضريبة بلغت ${totalTax} ج.م (تجاوزت الحد 100 ج.م).`;
      }

      return res.json({ success: true, reply });
    }

    // ── Command 3: List Orders / Pending ───────────────────────
    if (['/orders', '/pending', 'طلبات', 'الطلبات', 'معلق', 'المعلق'].includes(firstWord)) {
      const isPending = ['/pending', 'معلق', 'المعلق'].includes(firstWord);

      let query = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(5);
      if (isPending) query = query.eq('status', 'pending');

      const { data: orders, error } = await query;
      if (error) throw error;

      if (!orders || orders.length === 0) {
        return res.json({ success: true, reply: isPending ? '🎉 لا توجد طلبات معلقة حالياً!' : '📭 لا توجد طلبات في المتجر.' });
      }

      const list = orders.map((o, idx) => {
        const cleanPhone = (o.phone || '').toString().replace(/\D/g, '');
        const chatLink = cleanPhone.startsWith('01') ? `https://wa.me/2${cleanPhone}` : `https://wa.me/${cleanPhone}`;
        const items = Array.isArray(o.items) ? o.items.map(i => `${i.name} [${i.size || 'M'}]×${i.qty || 1}`).join('، ') : '';

        return `*${idx + 1}.* 🆔 \`${o.order_number}\`
👤 *${o.customer_name}*
📞 ${o.phone}
💬 [دردشة مع العميل](${chatLink})
📍 ${o.governorate} — ${o.address}
💰 *EGP ${o.total}* | حالة: *${o.status}*
📦 ${items}
⚙️ \`قبول ${o.order_number}\` | \`شحن ${o.order_number}\` | \`رفض ${o.order_number}\``;
      }).join('\n\n───────────────────\n\n');

      const header = isPending ? '⏳ *قائمة الطلبات المعلقة تنتظر المراجعة:*' : '📦 *أحدث 5 طلبات في المتجر:*';
      return res.json({ success: true, reply: `${header}\n\n${list}` });
    }

    // ── Command 4: Search ─────────────────────────────────────
    if (firstWord === '/search' || firstWord === 'بحث') {
      const queryTerm = parts.slice(1).join(' ').trim();
      if (!queryTerm) {
        return res.json({ success: true, reply: '⚠️ يرجى كتابة كلمة البحث بعد الأمر، مثال:\n`بحث 01012345678` أو `بحث VEXIS-1234`' });
      }

      const { data: orders, error } = await supabase
        .from('orders')
        .select('*')
        .or(`order_number.ilike.%${queryTerm}%,customer_name.ilike.%${queryTerm}%,phone.ilike.%${queryTerm}%`)
        .limit(5);

      if (error) throw error;

      if (!orders || orders.length === 0) {
        return res.json({ success: true, reply: `📭 لم يتم العثور على أي طلب يطابق: "${queryTerm}"` });
      }

      const list = orders.map(o => {
        const cleanPhone = (o.phone || '').toString().replace(/\D/g, '');
        const chatLink = cleanPhone.startsWith('01') ? `https://wa.me/2${cleanPhone}` : `https://wa.me/${cleanPhone}`;
        return `🆔 \`${o.order_number}\`
👤 *${o.customer_name}* (${o.phone})
💬 ${chatLink}
📍 ${o.governorate} — ${o.address}
💰 *EGP ${o.total}* | حالة: *${o.status}*
⚙️ \`قبول ${o.order_number}\` | \`شحن ${o.order_number}\` | \`تسليم ${o.order_number}\``;
      }).join('\n\n───────────────────\n\n');

      return res.json({ success: true, reply: `🔍 *نتائج البحث عن (${queryTerm}):*\n\n${list}` });
    }

    // ── Command 5: Quick Status Actions (قبول / شحن / تسليم / رفض) ──
    const action = firstWord;
    const orderNumberArg = (parts[1] || '').trim();

    if (['قبول', 'موافقة', 'تأكيد', 'شحن', 'تسليم', 'رفض'].includes(action) && orderNumberArg) {
      let targetStatus = '';
      if (['قبول', 'موافقة', 'تأكيد'].includes(action)) targetStatus = 'review';
      else if (action === 'شحن') targetStatus = 'shipped';
      else if (action === 'تسليم') targetStatus = 'delivered';
      else if (action === 'رفض') targetStatus = 'rejected';

      const reason = parts.slice(2).join(' ').trim();

      const { data: order, error: findErr } = await supabase
        .from('orders')
        .select('*')
        .ilike('order_number', `%${orderNumberArg}%`)
        .limit(1)
        .single();

      if (findErr || !order) {
        return res.json({ success: true, reply: `❌ لم يتم العثور على طلب بهذا الرقم: \`${orderNumberArg}\`` });
      }

      const updateData = { status: targetStatus };
      if (targetStatus === 'rejected' && reason) {
        updateData.rejection_reason = reason;
      }

      const { error: updateErr } = await supabase
        .from('orders')
        .update(updateData)
        .eq('order_number', order.order_number);

      if (updateErr) throw updateErr;

      const statusLabels = {
        review: '✅ قيد المراجعة والتأكيد (review)',
        shipped: '🚚 خرج للشحن مع المندوب (shipped)',
        delivered: '🎉 تم التسليم بنجاح (delivered)',
        rejected: '❌ مرفوض (rejected)',
      };

      if (['shipped', 'delivered'].includes(targetStatus)) {
        await notifyCustomerStatus(order.phone, order.customer_name, order.order_number, targetStatus);
      }

      let reply = `✅ *تم تحديث الطلب بنجاح!*
🆔 *رقم الطلب:* \`${order.order_number}\`
👤 *العميل:* ${order.customer_name} (${order.phone})
📌 *الحالة الجديدة:* ${statusLabels[targetStatus] || targetStatus}`;

      if (targetStatus === 'rejected') {
        reply += `\n📝 *سبب الرفض:* ${reason || 'لم يُحدد سبب'}`;
      } else if (['shipped', 'delivered'].includes(targetStatus)) {
        reply += `\n📲 *تم إرسال إشعار فوري للعميل على واتساب بتحديث الشحنة!*`;
      }

      return res.json({ success: true, reply });
    }

    // ── Command 6: Promo Codes Management (اكواد / كود) ───────
    if (['اكواد', 'أكواد', 'بروموكود', 'promos'].includes(firstWord)) {
      const { data: promos } = await supabase.from('promocodes').select('*').order('created_at', { ascending: false });
      if (!promos || promos.length === 0) {
        return res.json({ success: true, reply: '🏷️ لا توجد أكواد خصم مسجلة حالياً.' });
      }
      const list = promos.map(p => `• \`${p.code}\` — خصم *${p.discount_value}${p.discount_type === 'percent' ? '%' : ' EGP'}* | ${p.is_active ? '✅ نشط' : '❌ معطل'}`).join('\n');
      return res.json({ success: true, reply: `🏷️ *أكواد الخصم في المتجر:*\n\n${list}\n\n💡 لإنشاء كود جديد اكتب:\n\`كود [الاسم] [القيمة]\` مثال: \`كود VEXIS20 20\`` });
    }

    if (firstWord === 'كود' && parts.length >= 3) {
      const newCode = parts[1].toUpperCase().trim();
      const val = parseFloat(parts[2].replace(/[^\d.]/g, ''));
      if (!newCode || isNaN(val) || val <= 0) {
        return res.json({ success: true, reply: '⚠️ طريقة الاستخدام:\n`كود [الاسم] [النسبة]`\nمثال: `كود VEXIS20 20`' });
      }

      const { error: insErr } = await supabase.from('promocodes').upsert({
        code: newCode,
        discount_type: 'percent',
        discount_value: val,
        is_active: true,
      }, { onConflict: 'code' });

      if (insErr) throw insErr;
      return res.json({ success: true, reply: `✅ *تم تفعيل كود الخصم بنجاح!*\n🏷️ الكود: \`${newCode}\`\n💰 نسبة الخصم: *${val}%*` });
    }

    // ── Command 7: Products List (منتجات / مخزون) ──────────────
    if (['منتجات', 'المنتجات', 'مخزون', 'المخزون'].includes(firstWord)) {
      const { data: prods } = await supabase.from('products').select('*').order('created_at', { ascending: false });
      if (!prods || prods.length === 0) {
        return res.json({ success: true, reply: '📦 لا توجد منتجات مسجلة.' });
      }
      const list = prods.map(p => `• *${p.name}* — EGP ${p.price} | ${p.is_out_of_stock ? '🔴 نفد المخزون' : '🟢 متوفر'}`).join('\n');
      return res.json({ success: true, reply: `📦 *منتجات المتجر:*\n\n${list}` });
    }

    // ── Command 8: Direct Message to Customer (رسالة [phone] [text]) ──
    if (firstWord === 'رسالة' && parts.length >= 3) {
      const targetPhone = parts[1].replace(/\D/g, '');
      const msgText = parts.slice(2).join(' ');
      const sent = await sendDirectWAMessage(targetPhone, msgText);
      if (sent) {
        return res.json({ success: true, reply: `✅ تم إرسال الرسالة بنجاح إلى العميل (${targetPhone})!` });
      } else {
        return res.json({ success: true, reply: `❌ فشل إرسال الرسالة إلى (${targetPhone}). تحقق من الرقم.` });
      }
    }

    // Default Fallback for Admin
    return res.json({
      success: true,
      reply: `أهلاً بك يا أدمن VEXIS 👋
أرسل \`اوامر\` أو \`/help\` لعرض قائمة خيارات التحكم الكاملة في المتجر والمبيعات والطلبات.`
    });

  } catch (err) {
    console.error('[WhatsApp Admin Error]', err);
    return res.json({
      success: false,
      reply: `❌ حدث خطأ أثناء تنفيذ الأمر: ${err.message}`
    });
  }
}

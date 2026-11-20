// api/_whatsapp-admin.js — WhatsApp Admin Bot Control System for 01061927815
import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders } from './_auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.APISUPABASE_SERVICE_ROLE_KEY
);

const WA_API_SECRET = process.env.WA_API_SECRET || 'vexis-wa-2024-secret';
const WA_SERVICE_URL = process.env.WA_SERVICE_URL || 'https://vexis-whatsapp-service.onrender.com';
const ADMIN_PHONE = '201061927815';

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

  // 2. Verify Admin Phone
  if (!cleanFrom.endsWith('1061927815')) {
    return res.status(403).json({ success: false, error: 'Forbidden: sender is not admin' });
  }

  const text = (message || '').trim();
  if (!text) {
    return res.json({ success: true, reply: '⚠️ لم يتم استلام أي نص.' });
  }

  const lower = text.toLowerCase();
  const parts = text.split(/\s+/);
  const firstWord = parts[0].toLowerCase();

  try {
    // ── Command 1: Help & Menu ────────────────────────────────
    if (['/start', '/help', 'مساعدة', 'اوامر', 'أوامر', 'منيو', 'قائمة'].includes(firstWord)) {
      const reply = `👑 *لوحة تحكم إدارة VEXIS على واتساب* 🏋️🔥

*📊 أوامر التحليل والإحصائيات:*
• \`احصائيات\` أو \`/stats\` — إجمالي المبيعات، الأرباح، والضرائب
• \`اليوم\` أو \`/today\` — ملخص مبيعات وطلبات اليوم

*📦 أوامر الطلبات والاستعلام:*
• \`طلبات\` أو \`/orders\` — أحدث 5 طلبات في المتجر
• \`معلق\` أو \`/pending\` — الطلبات المعلقة في انتظار المراجعة
• \`بحث [رقم/هاتف/اسم]\` — بحث شامل في الطلبات

*⚡ أوامر سريعة لتحديث حالة أي أوردر:*
• \`قبول [رقم الطلب]\` — تأكيد الأوردر ومراجعته
• \`شحن [رقم الطلب]\` — تحويل لحالة "خرج للشحن" + إشعار العميل فوراً
• \`تسليم [رقم الطلب]\` — تحويل لحالة "تم التسليم" + إشعار العميل
• \`رفض [رقم الطلب] [سبب الرفض]\` — رفض الطلب مع تسجيل السبب

*مثال:*
\`شحن VEXIS-1234\`
\`بحث 01001234567\``;

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
        const items = Array.isArray(o.items) ? o.items.map(i => `${i.name} [${i.size || 'M'}]×${i.qty || 1}`).join('، ') : '';
        return `*${idx + 1}.* 🆔 \`${o.order_number}\`
👤 *${o.customer_name}* (${o.phone})
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
        return `🆔 \`${o.order_number}\`
👤 *${o.customer_name}* (${o.phone})
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

      // Find order
      const { data: order, error: findErr } = await supabase
        .from('orders')
        .select('*')
        .ilike('order_number', `%${orderNumberArg}%`)
        .limit(1)
        .single();

      if (findErr || !order) {
        return res.json({ success: true, reply: `❌ لم يتم العثور على طلب بهذا الرقم: \`${orderNumberArg}\`` });
      }

      // Update in DB
      const updateData = { status: targetStatus };
      if (targetStatus === 'rejected' && reason) {
        updateData.rejection_reason = reason;
      }

      const { error: updateErr } = await supabase
        .from('orders')
        .update(updateData)
        .eq('order_number', order.order_number);

      if (updateErr) throw updateErr;

      // Status labels for response
      const statusLabels = {
        review: '✅ قيد المراجعة والتأكيد (review)',
        shipped: '🚚 خرج للشحن مع المندوب (shipped)',
        delivered: '🎉 تم التسليم بنجاح (delivered)',
        rejected: '❌ مرفوض (rejected)',
      };

      // Automatically notify customer via WhatsApp if shipped or delivered
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
        reply += `\n📲 *تم إرسال إشعار فوري للعميل على واتساب!*`;
      }

      return res.json({ success: true, reply });
    }

    // ── Command 6: Explicit /status command ───────────────────
    if (firstWord === '/status' || firstWord === 'حالة') {
      const orderNum = parts[1];
      const newStatus = (parts[2] || '').toLowerCase();
      const valid = ['pending', 'review', 'confirmed', 'shipped', 'delivered', 'rejected', 'cancelled'];

      if (!orderNum || !newStatus || !valid.includes(newStatus)) {
        return res.json({
          success: true,
          reply: `⚠️ الاستخدام الصحيح:
\`/status [رقم الطلب] [الحالة]\`
الحالات المتاحة: \`pending\`, \`review\`, \`shipped\`, \`delivered\`, \`rejected\``
        });
      }

      const { data: order, error: findErr } = await supabase
        .from('orders')
        .select('*')
        .ilike('order_number', `%${orderNum}%`)
        .limit(1)
        .single();

      if (findErr || !order) {
        return res.json({ success: true, reply: `❌ لم يتم العثور على طلب برقم: \`${orderNum}\`` });
      }

      await supabase.from('orders').update({ status: newStatus }).eq('order_number', order.order_number);

      if (['shipped', 'delivered'].includes(newStatus)) {
        await notifyCustomerStatus(order.phone, order.customer_name, order.order_number, newStatus);
      }

      return res.json({
        success: true,
        reply: `✅ تم تحديث حالة الطلب \`${order.order_number}\` إلى: *${newStatus}*`
      });
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

import { setCorsHeaders, requireAdmin, safeError } from './_auth.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!requireAdmin(req)) {
    return res.status(401).json({ success: false, error: 'غير مصرح.' });
  }

  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      console.error('[upload] Missing Cloudinary vars:', {
        cloudName: !!cloudName,
        apiKey: !!apiKey,
        apiSecret: !!apiSecret
      });
      return res.status(500).json({
        success: false,
        error: 'Cloudinary غير مضبوط - تأكد من إضافة CLOUDINARY_CLOUD_NAME و CLOUDINARY_API_KEY و CLOUDINARY_API_SECRET في Vercel'
      });
    }

    const { data, fileName } = req.body || {};

    if (!data) {
      return res.status(400).json({ success: false, error: 'No image data provided.' });
    }

    if (typeof data !== 'string' || !data.startsWith('data:')) {
      return res.status(400).json({ success: false, error: 'بيانات الصورة غير صالحة' });
    }

    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'vexis-store';

    const { createHash } = await import('crypto');
    const sig = createHash('sha1')
      .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
      .digest('hex');

    const formData = new URLSearchParams();
    formData.append('file', data);
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp.toString());
    formData.append('folder', folder);
    formData.append('signature', sig);

    console.log('[upload] Uploading to Cloudinary...', {
      folder,
      cloudName,
      fileNameHint: fileName || 'unknown'
    });

    const cloudinaryRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: 'POST', body: formData }
    );

    const cloudinaryData = await cloudinaryRes.json();

    if (!cloudinaryRes.ok || cloudinaryData.error) {
      console.error('[upload] Cloudinary error:', cloudinaryData.error || cloudinaryData);
      throw new Error(cloudinaryData.error?.message || 'Cloudinary upload failed');
    }

    console.log('[upload] ✅ Success:', cloudinaryData.secure_url);

    return res.status(200).json({
      success: true,
      url: cloudinaryData.secure_url,
      public_id: cloudinaryData.public_id
    });

  } catch (err) {
    console.error('[API /upload] Error:', err.message || err);
    return res.status(500).json({ success: false, error: err.message || 'حدث خطأ داخلي.' });
  }
}
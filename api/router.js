import adminAuth from './_admin-auth.js';
import categories from './_categories.js';
import categoriesId from './categories/_[id].js';
import checkout from './_checkout.js';
import notify from './_notify.js';
import orderReceipt from './_order-receipt.js';
import order from './_order.js';
import orders from './_orders.js';
import products from './_products.js';
import productsId from './products/_[id].js';
import reviews from './_reviews.js';
import sendInvoice from './_send_invoice.js';
import uploadReceipt from './_upload-receipt.js';
import upload from './_upload.js';
import whatsappWebhook from './_whatsapp-webhook.js';
import telegramWebhook from './_telegram-webhook.js';
import setWebhook from './_set-webhook.js';
import ordersByPhone from './_orders-by-phone.js';

export default async function handler(req, res) {
  let { __path } = req.query;
  
  if (!__path) {
    const url = new URL(req.url, 'http://localhost');
    const pathParts = url.pathname.replace(/^\/api\//, '').split('/');
    __path = pathParts.join('/');
  }

  __path = __path.replace(/^\/+|\/+$/g, '');
  delete req.query.__path;

  let targetHandler = null;
  
  if (__path === 'admin-auth') {
    targetHandler = adminAuth;
  } else if (__path === 'categories') {
    targetHandler = categories;
  } else if (__path.startsWith('categories/')) {
    const id = __path.substring('categories/'.length);
    req.query.id = id;
    targetHandler = categoriesId;
  } else if (__path === 'checkout') {
    targetHandler = checkout;
  } else if (__path === 'notify') {
    targetHandler = notify;
  } else if (__path === 'order-receipt') {
    targetHandler = orderReceipt;
  } else if (__path === 'order') {
    targetHandler = order;
  } else if (__path === 'orders') {
    targetHandler = orders;
  } else if (__path === 'products') {
    targetHandler = products;
  } else if (__path.startsWith('products/')) {
    const id = __path.substring('products/'.length);
    req.query.id = id;
    targetHandler = productsId;
  } else if (__path === 'reviews') {
    targetHandler = reviews;
  } else if (__path === 'send_invoice') {
    targetHandler = sendInvoice;
  } else if (__path === 'upload-receipt') {
    targetHandler = uploadReceipt;
  } else if (__path === 'upload') {
    targetHandler = upload;
  } else if (__path === 'whatsapp-webhook') {
    targetHandler = whatsappWebhook;
  } else if (__path === 'telegram-webhook') {
    targetHandler = telegramWebhook;
  } else if (__path === 'set-webhook') {
    targetHandler = setWebhook;
  } else if (__path === 'orders-by-phone') {
    targetHandler = ordersByPhone;
  }

  if (targetHandler) {
    return targetHandler(req, res);
  } else {
    return res.status(404).json({ success: false, error: `Route /api/${__path} not found` });
  }
}

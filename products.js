/* ══════════════════════════════════════════════
   Live data loader — replaces the old mock arrays.
   Fetches real products/categories from the PHP API
   and exposes them the same way old code expected,
   plus fires events so pages can re-render once data arrives.
   ══════════════════════════════════════════════ */

// Keep these defined immediately so nothing throws if read
// before the fetch resolves (e.g. inline scripts running early).
window.mockProducts = [];
window.mockCategories = [{ slug: '', name: 'الكل', emoji: '👕' }];

window.productsReady = false;
window.categoriesReady = false;

// Basic slug → emoji fallback (DB categories table has no emoji column).
// Extend this list as you add real categories.
const CATEGORY_EMOJI_MAP = {
  compression: '👕',
  shorts: '🩳',
  hoodies: '🧥',
  sneakers: '👟',
  slippers: '🩴',
  sports: '🏃',
};

function guessEmoji(slug) {
  return CATEGORY_EMOJI_MAP[slug] || '👕';
}

async function loadProducts() {
  try {
    const res = await fetch('/api/products', {
      method: 'GET',
      
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.error || 'Failed to load products');

    window.mockProducts = (data.products || []).map(p => ({
      id: p.id,
      name: p.name,
      type: p.type,
      price: Number(p.price),
      discount_type: p.discount_type || 'none',
      discount_value: Number(p.discount_value || 0),
     image_url: (p.image_url && p.image_url !== "0" && p.image_url !== 0)
  ? p.image_url
  : (Array.isArray(p.gallery) && p.gallery.length ? p.gallery[0] : null),
      image_hover: Array.isArray(p.gallery) && p.gallery.length > 1 ? p.gallery[1] : (p.image_url || null),
      gallery: Array.isArray(p.gallery) ? p.gallery : (p.image_url ? [p.image_url] : []),
      sizes: Array.isArray(p.sizes) ? p.sizes : [],
      colors: Array.isArray(p.colors) ? p.colors : [],
      created_at: p.created_at || new Date().toISOString(),
      description: p.description || '',
    }));

    window.productsReady = true;
    window.dispatchEvent(new CustomEvent('productsLoaded', { detail: window.mockProducts }));
  } catch (err) {
    console.error('Failed to load products from API:', err);
    window.mockProducts = [
      {
        id: 'vx-compression-black',
        name: 'VEXIS Pro Compression T-Shirt - Black',
        type: 'compression',
        price: 499,
        discount_type: 'percent',
        discount_value: 20,
        image_url: 'shrt.jpeg',
        image_hover: 'shrt.jpeg',
        gallery: ['shrt.jpeg', 'بدايه.jpeg'],
        sizes: ['S', 'M', 'L', 'XL'],
        colors: [{ name: 'أسود', hex: '#111111' }, { name: 'أبيض', hex: '#ffffff' }],
        created_at: new Date().toISOString(),
        description: 'Engineered Dri-Fit high-performance compression wear designed for physique definition and elite gym training.'
      },
      {
        id: 'vx-series-pack',
        name: 'VEXIS Athletic Compression Wear - Navy',
        type: 'compression',
        price: 450,
        discount_type: 'none',
        discount_value: 0,
        image_url: 'shrt.jpeg',
        image_hover: 'بدايه.jpeg',
        gallery: ['shrt.jpeg', 'بدايه.jpeg'],
        sizes: ['S', 'M', 'L', 'XL'],
        colors: [{ name: 'كحلي', hex: '#1e3a8a' }, { name: 'أسود', hex: '#111111' }],
        created_at: new Date().toISOString(),
        description: 'Engineered Dri-Fit high-performance compression wear designed for physique definition and elite gym training.'
      }
    ];
    window.productsReady = true;
    window.dispatchEvent(new CustomEvent('productsLoaded', { detail: window.mockProducts }));
  }
}

async function loadCategories() {
  try {
    const res = await fetch('/api/categories', {
      method: 'GET',
      
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.error || 'Failed to load categories');

    const dbCategories = (data.categories || []).map(c => ({
      slug: c.slug,
      name: c.name,
      emoji: guessEmoji(c.slug),
    }));

    window.mockCategories = [{ slug: '', name: 'الكل', emoji: '👕' }, ...dbCategories];

    window.categoriesReady = true;
    window.dispatchEvent(new CustomEvent('categoriesLoaded', { detail: window.mockCategories }));
  } catch (err) {
    console.error('Failed to load categories from API:', err);
    window.categoriesReady = true;
    window.dispatchEvent(new CustomEvent('categoriesLoaded', { detail: window.mockCategories }));
  }
}

// Kick off both loads immediately.
loadProducts();
loadCategories();
// SQLite via Node's built-in module (Node >= 22.13). Creates schema and seeds demo data on first run.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dir = path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, 'kartly.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL,
  hue INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  brand TEXT NOT NULL,
  description TEXT NOT NULL,
  price INTEGER NOT NULL,
  mrp INTEGER NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  stock INTEGER NOT NULL DEFAULT 0,
  rating_avg REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, user_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  subtotal INTEGER NOT NULL,
  shipping INTEGER NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Placed',
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  pincode TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
`);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return test.length === real.length && crypto.timingSafeEqual(test, real);
}
function recalcRating(productId) {
  const r = db.prepare('SELECT COUNT(*) c, COALESCE(AVG(rating),0) a FROM reviews WHERE product_id = ?').get(productId);
  db.prepare('UPDATE products SET rating_count = ?, rating_avg = ? WHERE id = ?').run(r.c, Math.round(r.a * 10) / 10, productId);
}
function tx(fn) {
  db.exec('BEGIN');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function seed() {
  const addUser = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)');
  addUser.run('Store Admin', 'admin@kartly.test', hashPassword('admin123'), 'admin');
  addUser.run('Demo Shopper', 'demo@kartly.test', hashPassword('demo123'), 'customer');
  addUser.run('Priya Rao', 'priya@kartly.test', hashPassword('demo123'), 'customer');

  const cats = [
    ['Electronics', 'electronics', '📱', 205],
    ['Books', 'books', '📚', 28],
    ['Fashion', 'fashion', '👕', 340],
    ['Home & Kitchen', 'home-kitchen', '🍳', 150],
    ['Beauty', 'beauty', '💄', 285],
    ['Sports', 'sports', '🏏', 95],
  ];
  const addCat = db.prepare('INSERT INTO categories (name,slug,icon,hue) VALUES (?,?,?,?)');
  cats.forEach(c => addCat.run(...c));

  const items = {
    electronics: [
      ['Noise-Cancelling Wireless Headphones', 'Sonara', 4999, 7999, 'Over-ear Bluetooth 5.3 headphones with active noise cancellation, 40-hour battery and a foldable design.'],
      ['Smart Fitness Band 2', 'Pulse', 1799, 2999, 'AMOLED display, heart-rate and SpO2 tracking, 14-day battery and 5ATM water resistance.'],
      ['20000 mAh Power Bank', 'VoltEdge', 1299, 1999, 'Dual-output fast-charging power bank with USB-C PD and a digital charge indicator.'],
      ['Bluetooth Speaker Mini', 'Sonara', 1499, 2499, 'Pocket-size 12W speaker with deep bass, IPX7 waterproofing and 15-hour playtime.'],
      ['USB-C Fast Charger 65W', 'VoltEdge', 1199, 1799, 'GaN charger that powers a laptop and a phone at the same time. Foldable pins.'],
      ['Mechanical Keyboard TKL', 'KeyForge', 3499, 4999, 'Tenkeyless hot-swappable keyboard with tactile switches and per-key backlight.'],
    ],
    books: [
      ['Clean Code', 'Robert C. Martin', 599, 899, 'A handbook of agile software craftsmanship: write code that is readable and maintainable.'],
      ['The Pragmatic Programmer', 'Hunt & Thomas', 749, 1099, 'Timeless advice for developers on tooling, design and the habits of effective programmers.'],
      ['Deep Work', 'Cal Newport', 399, 599, 'Rules for focused success in a distracted world.'],
      ['Sapiens: A Brief History of Humankind', 'Yuval Noah Harari', 449, 699, 'A sweeping look at how Homo sapiens came to dominate the planet.'],
      ['Introduction to Algorithms', 'Cormen et al.', 1499, 2199, 'The standard reference on algorithms and data structures used in universities worldwide.'],
      ['The Psychology of Money', 'Morgan Housel', 349, 499, 'Timeless lessons on wealth, greed and happiness.'],
    ],
    fashion: [
      ["Men's Cotton Crew T-Shirt (Pack of 3)", 'Weave&Co', 699, 1499, 'Soft 100% combed cotton, regular fit, pre-shrunk and colourfast.'],
      ["Women's Cotton Straight Kurta", 'Aaranya', 899, 1799, 'Breathable cotton kurta with block print and three-quarter sleeves.'],
      ['Lightweight Running Shoes', 'Stride', 1999, 3499, 'Breathable mesh upper, cushioned EVA midsole and a grippy outsole.'],
      ['Classic Denim Jacket', 'Weave&Co', 1599, 2999, 'Mid-wash denim jacket with button closure and two chest pockets.'],
      ['Genuine Leather Bifold Wallet', 'Tanner', 549, 999, 'Slim bifold with 6 card slots, coin pocket and RFID protection.'],
      ['Polarised Aviator Sunglasses', 'Shade', 799, 1999, 'UV400 polarised lenses with a lightweight metal frame.'],
    ],
    'home-kitchen': [
      ['Non-Stick Cookware Set (5 pcs)', 'Hearth', 2299, 3999, 'Induction-friendly set: kadai, fry pan, tawa and two lids with cool-touch handles.'],
      ['Electric Kettle 1.5L', 'Hearth', 699, 1199, 'Stainless steel kettle with auto shut-off and boil-dry protection.'],
      ['Mixer Grinder 750W', 'Whirl', 2799, 4499, 'Three stainless steel jars, three speeds plus pulse, 2-year warranty.'],
      ['Cotton Bedsheet, Queen (2 pillow covers)', 'Nidra', 799, 1599, '240 TC cotton bedsheet in a modern geometric print. Machine washable.'],
      ['Vacuum Insulated Bottle 1L', 'Keepcool', 649, 1099, 'Keeps drinks cold for 24 hours and hot for 12. Leak-proof lid.'],
      ['LED Desk Lamp with Wireless Charger', 'Lumen', 1399, 2299, 'Five colour modes, touch dimmer and a 10W Qi charging pad in the base.'],
    ],
    beauty: [
      ['Vitamin C Face Serum 30ml', 'Dewlab', 449, 799, '10% Vitamin C with hyaluronic acid for brighter, even-toned skin.'],
      ['Sunscreen SPF 50 PA++++ 50g', 'Dewlab', 399, 650, 'Lightweight, non-greasy broad-spectrum sunscreen with no white cast.'],
      ['Herbal Anti-Dandruff Shampoo 340ml', 'Veda', 299, 450, 'Neem and tea tree shampoo, sulphate-free and gentle for daily use.'],
      ['Cordless Beard Trimmer', 'Groom', 1099, 1899, '20 length settings, 60-minute runtime and USB-C charging.'],
      ['Intense Moisturising Cream 200ml', 'Veda', 349, 549, 'Shea butter and aloe cream for 24-hour hydration.'],
      ['Eau de Parfum 100ml', 'Oud&Co', 1299, 2499, 'Woody, long-lasting fragrance with notes of cedar, amber and bergamot.'],
    ],
    sports: [
      ['Kashmir Willow Cricket Bat', 'Strike', 1299, 2299, 'Full-size, ready-to-play bat with a cane handle and anti-scuff sheet.'],
      ['Yoga Mat 6mm Anti-Slip', 'Flexa', 599, 1199, 'Dense, cushioned mat with a carry strap and non-slip texture.'],
      ['Adjustable Dumbbell Set 10kg', 'IronPeak', 1899, 2999, 'Chrome plates with a comfortable grip and secure collar locks.'],
      ['Badminton Racket Pair with Shuttles', 'Smashly', 849, 1599, 'Two aluminium rackets, three shuttlecocks and a zip carry case.'],
      ['Football Size 5', 'Strike', 549, 999, 'Machine-stitched match ball with a durable PU cover.'],
      ['Speed Skipping Rope', 'Flexa', 249, 499, 'Adjustable steel-cable rope with ball bearings and foam handles.'],
    ],
  };
  const catId = {};
  db.prepare('SELECT id, slug FROM categories').all().forEach(c => (catId[c.slug] = c.id));
  const addP = db.prepare('INSERT INTO products (title,brand,description,price,mrp,category_id,stock) VALUES (?,?,?,?,?,?,?)');
  const addR = db.prepare('INSERT INTO reviews (product_id,user_id,rating,title,body) VALUES (?,?,?,?,?)');
  const comments = [
    [5, 'Excellent', 'Great quality for the price. Would buy again.'],
    [4, 'Good value', 'Works as described. Delivery was quick.'],
    [5, 'Highly recommended', 'Better than expected, very happy with it.'],
    [3, 'Decent', 'Does the job, but the packaging could be better.'],
    [4, 'Solid purchase', 'Build quality feels good and it has held up well.'],
  ];
  let n = 0;
  for (const [slug, list] of Object.entries(items)) {
    for (const [title, brand, price, mrp, desc] of list) {
      const id = Number(addP.run(title, brand, desc, price, mrp, catId[slug], 15 + ((n * 7) % 60)).lastInsertRowid);
      const c1 = comments[n % comments.length];
      const c2 = comments[(n + 2) % comments.length];
      addR.run(id, 2, c1[0], c1[1], c1[2]);
      if (n % 3 !== 0) addR.run(id, 3, c2[0], c2[1], c2[2]);
      recalcRating(id);
      n++;
    }
  }
}

if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) tx(seed);

module.exports = { db, tx, hashPassword, checkPassword, recalcRating };

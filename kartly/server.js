const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { db, tx, hashPassword, checkPassword, recalcRating } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const FREE_SHIPPING_ABOVE = 499;
const SHIPPING_FEE = 49;
const STATUSES = ['Placed', 'Packed', 'Shipped', 'Out for delivery', 'Delivered', 'Cancelled'];

const SECRET = process.env.JWT_SECRET || (() => {
  const f = path.join(__dirname, 'data', 'secret.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'));
  return fs.readFileSync(f, 'utf8');
})();

app.use(express.json({ limit: '100kb' }));

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);
const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const issue = (u) => ({ token: sign({ uid: u.id, exp: Date.now() + 7 * 864e5 }), user: publicUser(u) });

function auth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const p = m && verify(m[1]);
  const user = p && db.prepare('SELECT * FROM users WHERE id = ?').get(p.uid);
  if (!user) return next(new HttpError(401, 'Please log in to continue.'));
  req.user = user;
  next();
}
const admin = (req, res, next) => (req.user.role === 'admin' ? next() : next(new HttpError(403, 'Admins only.')));

/* ---------- auth ---------- */
app.post('/api/auth/register', wrap((req, res) => {
  const name = str(req.body.name, 80), email = str(req.body.email, 120).toLowerCase(), pw = String(req.body.password || '');
  if (name.length < 2) throw bad('Enter your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address.');
  if (pw.length < 6) throw bad('Password must be at least 6 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('An account with this email already exists.');
  const id = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)').run(name, email, hashPassword(pw)).lastInsertRowid;
  res.status(201).json(issue(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
}));
app.post('/api/auth/login', wrap((req, res) => {
  const email = str(req.body.email, 120).toLowerCase(), pw = String(req.body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !checkPassword(pw, u.password_hash)) throw new HttpError(401, 'Incorrect email or password.');
  res.json(issue(u));
}));
app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

/* ---------- catalog ---------- */
const PRODUCT_COLS = `p.id, p.title, p.brand, p.price, p.mrp, p.stock, p.rating_avg, p.rating_count,
  c.name AS category, c.slug AS category_slug`;
const PRODUCT_FROM = 'FROM products p JOIN categories c ON c.id = p.category_id';

app.get('/api/categories', (req, res) => {
  res.json(db.prepare(`SELECT c.id, c.name, c.slug, c.icon, c.hue, COUNT(p.id) AS count
    FROM categories c LEFT JOIN products p ON p.category_id = c.id GROUP BY c.id ORDER BY c.id`).all());
});

app.get('/api/products', wrap((req, res) => {
  const where = [], params = [];
  const q = str(req.query.q, 80);
  if (q) {
    where.push('(p.title LIKE ? OR p.brand LIKE ? OR p.description LIKE ?)');
    const like = `%${q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like);
  }
  if (req.query.category) { where.push('c.slug = ?'); params.push(str(req.query.category, 40)); }
  if (req.query.min) { where.push('p.price >= ?'); params.push(int(req.query.min)); }
  if (req.query.max) { where.push('p.price <= ?'); params.push(int(req.query.max, 1e9)); }
  if (req.query.ids) {
    const ids = String(req.query.ids).split(',').map(Number).filter(Number.isInteger).slice(0, 50);
    if (!ids.length) return res.json({ items: [], total: 0, page: 1, pages: 1 });
    where.push(`p.id IN (${ids.map(() => '?').join(',')})`); params.push(...ids);
  }
  const sorts = {
    price_asc: 'p.price ASC', price_desc: 'p.price DESC', rating: 'p.rating_avg DESC, p.rating_count DESC',
    newest: 'p.id DESC', discount: '(p.mrp - p.price) * 1.0 / p.mrp DESC', relevance: 'p.rating_count DESC, p.id ASC',
  };
  const order = sorts[req.query.sort] || sorts.relevance;
  const limit = Math.min(Math.max(int(req.query.limit, 12), 1), 50);
  const page = Math.max(int(req.query.page, 1), 1);
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c ${PRODUCT_FROM} ${w}`).get(...params).c;
  const items = db.prepare(`SELECT ${PRODUCT_COLS} ${PRODUCT_FROM} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);
  res.json({ items, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
}));

app.get('/api/products/:id', wrap((req, res) => {
  const p = db.prepare(`SELECT ${PRODUCT_COLS}, p.description ${PRODUCT_FROM} WHERE p.id = ?`).get(int(req.params.id));
  if (!p) throw new HttpError(404, 'Product not found.');
  const reviews = db.prepare(`SELECT r.id, r.rating, r.title, r.body, r.created_at, u.name AS user
    FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.product_id = ? ORDER BY r.id DESC`).all(p.id);
  res.json({ ...p, reviews });
}));

app.post('/api/products/:id/reviews', auth, wrap((req, res) => {
  const pid = int(req.params.id), rating = int(req.body.rating);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(pid)) throw new HttpError(404, 'Product not found.');
  if (rating < 1 || rating > 5) throw bad('Choose a rating from 1 to 5.');
  db.prepare(`INSERT INTO reviews (product_id,user_id,rating,title,body) VALUES (?,?,?,?,?)
    ON CONFLICT(product_id,user_id) DO UPDATE SET rating=excluded.rating, title=excluded.title, body=excluded.body`)
    .run(pid, req.user.id, rating, str(req.body.title, 100), str(req.body.body, 1000));
  recalcRating(pid);
  res.status(201).json({ ok: true });
}));

// Generated SVG product image (no external assets needed). Swap for real images in production.
app.get('/api/img/:id.svg', (req, res) => {
  const p = db.prepare(`SELECT p.title, c.icon, c.hue FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?`).get(int(req.params.id));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hue = p ? p.hue : 200, icon = p ? p.icon : '🛍️';
  const label = p ? p.title.split(' ').slice(0, 2).join(' ') : '';
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue},60%,90%)"/><stop offset="1" stop-color="hsl(${(hue + 30) % 360},55%,78%)"/></linearGradient></defs>
<rect width="400" height="400" fill="url(#g)"/><text x="200" y="220" font-size="150" text-anchor="middle">${icon}</text>
<text x="200" y="330" font-size="22" text-anchor="middle" font-family="sans-serif" fill="hsl(${hue},40%,25%)">${esc(label)}</text></svg>`);
});

/* ---------- orders ---------- */
app.post('/api/orders', auth, wrap((req, res) => {
  const { items, shipping: s = {}, payment } = req.body;
  if (!Array.isArray(items) || !items.length) throw bad('Your cart is empty.');
  const addr = { name: str(s.name, 80), phone: str(s.phone, 15), address: str(s.address, 300), city: str(s.city, 60), pincode: str(s.pincode, 10) };
  if (!addr.name || !addr.address || !addr.city) throw bad('Fill in your name, address and city.');
  if (!/^\d{10}$/.test(addr.phone)) throw bad('Enter a 10-digit phone number.');
  if (!/^\d{6}$/.test(addr.pincode)) throw bad('Enter a 6-digit PIN code.');
  if (!['cod', 'upi', 'card'].includes(payment)) throw bad('Choose a payment method.');

  const orderId = tx(() => {
    let subtotal = 0;
    const lines = [];
    for (const it of items.slice(0, 50)) {
      const qty = int(it.qty);
      if (qty < 1 || qty > 10) throw bad('Quantity must be between 1 and 10.');
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(int(it.id));
      if (!p) throw bad('A product in your cart is no longer available.');
      if (p.stock < qty) throw bad(`Only ${p.stock} left of "${p.title}".`);
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, p.id);
      subtotal += p.price * qty;
      lines.push([p, qty]);
    }
    const shipping = subtotal >= FREE_SHIPPING_ABOVE ? 0 : SHIPPING_FEE;
    const id = Number(db.prepare(`INSERT INTO orders (user_id,subtotal,shipping,total,payment_method,payment_status,name,phone,address,city,pincode)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, subtotal, shipping, subtotal + shipping, payment,
      payment === 'cod' ? 'Pay on delivery' : 'Paid (demo)', addr.name, addr.phone, addr.address, addr.city, addr.pincode).lastInsertRowid);
    const ins = db.prepare('INSERT INTO order_items (order_id,product_id,title,price,qty) VALUES (?,?,?,?,?)');
    lines.forEach(([p, qty]) => ins.run(id, p.id, p.title, p.price, qty));
    return id;
  });
  res.status(201).json({ id: orderId });
}));

const loadOrder = (o) => ({ ...o, items: db.prepare('SELECT product_id, title, price, qty FROM order_items WHERE order_id = ?').all(o.id) });
app.get('/api/orders', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id).map(loadOrder));
});
app.get('/api/orders/:id', auth, wrap((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(int(req.params.id));
  if (!o || (o.user_id !== req.user.id && req.user.role !== 'admin')) throw new HttpError(404, 'Order not found.');
  res.json(loadOrder(o));
}));
app.post('/api/orders/:id/cancel', auth, wrap((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(int(req.params.id), req.user.id);
  if (!o) throw new HttpError(404, 'Order not found.');
  if (!['Placed', 'Packed'].includes(o.status)) throw bad('This order can no longer be cancelled.');
  tx(() => {
    db.prepare("UPDATE orders SET status = 'Cancelled' WHERE id = ?").run(o.id);
    db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(o.id)
      .forEach((i) => i.product_id && db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(i.qty, i.product_id));
  });
  res.json({ ok: true });
}));

/* ---------- admin ---------- */
app.get('/api/admin/stats', auth, admin, (req, res) => {
  res.json({
    orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    revenue: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status != 'Cancelled'").get().s,
    customers: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'customer'").get().c,
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    lowStock: db.prepare('SELECT id, title, stock FROM products WHERE stock <= 10 ORDER BY stock ASC LIMIT 10').all(),
  });
});
app.get('/api/admin/orders', auth, admin, (req, res) => {
  res.json(db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 200').all().map(loadOrder));
});
app.patch('/api/admin/orders/:id', auth, admin, wrap((req, res) => {
  if (!STATUSES.includes(req.body.status)) throw bad('Invalid status.');
  const r = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(req.body.status, int(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Order not found.');
  res.json({ ok: true });
}));

function readProduct(b) {
  const p = { title: str(b.title, 150), brand: str(b.brand, 60), description: str(b.description, 2000),
    price: int(b.price), mrp: int(b.mrp), stock: int(b.stock, -1), category_id: int(b.category_id) };
  if (!p.title || !p.brand) throw bad('Title and brand are required.');
  if (p.price < 1 || p.mrp < p.price) throw bad('Price must be positive and not above the MRP.');
  if (p.stock < 0) throw bad('Stock cannot be negative.');
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(p.category_id)) throw bad('Choose a category.');
  return p;
}
app.post('/api/admin/products', auth, admin, wrap((req, res) => {
  const p = readProduct(req.body);
  const id = db.prepare('INSERT INTO products (title,brand,description,price,mrp,stock,category_id) VALUES (?,?,?,?,?,?,?)')
    .run(p.title, p.brand, p.description, p.price, p.mrp, p.stock, p.category_id).lastInsertRowid;
  res.status(201).json({ id: Number(id) });
}));
app.put('/api/admin/products/:id', auth, admin, wrap((req, res) => {
  const p = readProduct(req.body);
  const r = db.prepare('UPDATE products SET title=?,brand=?,description=?,price=?,mrp=?,stock=?,category_id=? WHERE id=?')
    .run(p.title, p.brand, p.description, p.price, p.mrp, p.stock, p.category_id, int(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Product not found.');
  res.json({ ok: true });
}));
app.delete('/api/admin/products/:id', auth, admin, wrap((req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(int(req.params.id));
  res.json({ ok: true });
}));

/* ---------- static + errors ---------- */
app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found.')));
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => {
  if (!(err instanceof HttpError)) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => console.log(`Kartly running at http://localhost:${PORT}`));

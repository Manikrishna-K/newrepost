# Kartly – full-stack e-commerce store

Node.js + Express backend, SQLite database (Node's built-in module), plain HTML/CSS/JS frontend. Only one npm dependency (`express`), no build step.

## Run it

Requires **Node.js 22.13 or newer** (https://nodejs.org).

```
npm install
npm start
```

Open http://localhost:3000. The database is created and seeded with 36 products on first run.
Run `npm run reset` to wipe the database and start fresh.

| Role     | Email               | Password |
|----------|---------------------|----------|
| Customer | demo@kartly.test    | demo123  |
| Admin    | admin@kartly.test   | admin123 |

Change the demo passwords before deploying. Set `PORT` and `JWT_SECRET` as environment variables if needed.

## Features

**Shopper:** home page with deals and top rated, category browsing, search, price filter, sorting, pagination, product pages with reviews and ratings, cart (saved in the browser), checkout with address and payment choice (COD / UPI / card, simulated), order history, order tracking, order cancellation (stock is restored).

**Admin (/#/admin):** dashboard (orders, revenue, customers, low stock), add/edit/delete products, view all orders and update their status.

**Backend:** signup/login with scrypt password hashing and signed tokens, server-side price and stock validation (the client can't change prices), transactional order placement so stock can't oversell, role-based admin routes, input validation, XSS-safe rendering.

## Structure

```
server.js        Express app and all API routes
db.js            Schema, seed data, password helpers
public/
  index.html     App shell
  css/app.css    Styles
  js/app.js      Single-page app (hash routing)
```

## API overview

```
POST /api/auth/register | /api/auth/login      GET /api/auth/me
GET  /api/categories
GET  /api/products?q=&category=&min=&max=&sort=&page=
GET  /api/products/:id          POST /api/products/:id/reviews
POST /api/orders                GET  /api/orders      GET /api/orders/:id
POST /api/orders/:id/cancel
GET  /api/admin/stats | /api/admin/orders       PATCH /api/admin/orders/:id
POST /api/admin/products        PUT|DELETE /api/admin/products/:id
```

## Before going live

- Payments are simulated. Integrate a real gateway (Razorpay, Stripe) and confirm payment on the server before marking an order paid.
- Product images are generated SVG placeholders (`/api/img/:id.svg`). Add an image upload or URL field for real photos.
- Serve over HTTPS, set a strong `JWT_SECRET`, and add rate limiting on the auth routes.
- For high traffic, move from SQLite to PostgreSQL/MySQL.
- Currency is ₹ (see `inr()` in `public/js/app.js`); free-shipping threshold and fee are in `server.js` and `app.js`.

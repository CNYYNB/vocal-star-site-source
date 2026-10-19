const SESSION_DAYS = 30;
const PACKAGE_AMOUNT_CNY = 5;
const PACKAGE_STARS = 100;
const PROCESS_COST = 1;
const PBKDF2_ITERATIONS = 100000;
const PACKAGES = [5, 10, 20, 30, 50, 100];

export async function onRequest(context) {
  try {
    if (context.request.method === 'OPTIONS') return new Response(null, { status: 204 });
    return await route(context);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: '服务器错误，请稍后重试' }, 500);
  }
}

async function route(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: '未绑定 D1 数据库：请确认 wrangler.toml 中的 DB binding 已配置' }, 500);

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === 'health') return json({ ok: true, runtime: 'cloudflare-pages-functions' });

  if (method === 'POST' && path === 'auth/register') return register(context);
  if (method === 'POST' && path === 'auth/login') return login(context);
  if (method === 'POST' && path === 'auth/logout') return logout(context);
  if (method === 'GET' && path === 'me') return me(context);

  if (method === 'GET' && path === 'packages') return json({ packages: PACKAGES.map(amountCny => ({ amountCny, stars: amountCny * 20 })) });
  if (method === 'GET' && path === 'pay-info') return payInfo(context);
  if (method === 'POST' && path === 'orders') return createOrder(context);
  if (method === 'GET' && path === 'orders') return listMyOrders(context);

  const userPaidMatch = path.match(/^orders\/([^/]+)\/user-paid$/);
  if (method === 'POST' && userPaidMatch) return markOrderUserPaid(context, userPaidMatch[1]);

  if (method === 'GET' && path === 'admin/orders') return adminListOrders(context);

  const adminApproveMatch = path.match(/^admin\/orders\/([^/]+)\/approve$/);
  if (method === 'POST' && adminApproveMatch) return adminApproveOrder(context, adminApproveMatch[1]);

  const adminRejectMatch = path.match(/^admin\/orders\/([^/]+)\/reject$/);
  if (method === 'POST' && adminRejectMatch) return adminRejectOrder(context, adminRejectMatch[1]);

  const adminAddStarsMatch = path.match(/^admin\/users\/([^/]+)\/add-stars$/);
  if (method === 'POST' && adminAddStarsMatch) return adminAddStars(context, adminAddStarsMatch[1]);

  if (method === 'POST' && path === 'process/consume') return consumeStar(context);
  if (method === 'POST' && path === 'process/refund') return refundStar(context);

  return json({ error: '接口不存在' }, 404);
}

async function register({ request, env }) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');

  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: '请输入正确的邮箱' }, 400);
  if (password.length < 6) return json({ error: '密码至少 6 位' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return json({ error: '这个邮箱已经注册' }, 409);

  const userId = makeId('user');
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const now = nowIso();
  const token = makeId('sess');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, email, password_salt, password_hash, stars, created_at) VALUES (?, ?, ?, ?, 0, ?)').bind(userId, email, salt, hash, now),
    env.DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(token, userId, now, expiresAt)
  ]);

  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  return json({ token, user: safeUser(user) });
}

async function login({ request, env }) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user) return json({ error: '邮箱或密码错误' }, 401);

  const hash = await hashPassword(password, user.password_salt);
  if (hash !== user.password_hash) return json({ error: '邮箱或密码错误' }, 401);

  const token = makeId('sess');
  const now = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(token, user.id, now, expiresAt).run();

  return json({ token, user: safeUser(user) });
}

async function logout(context) {
  const session = await requireUser(context);
  await context.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(session.token).run();
  return json({ ok: true });
}

async function me(context) {
  const session = await requireUser(context);
  return json({ user: safeUser(session.user) });
}

async function payInfo({ env }) {
  return json({
    amountCny: PACKAGE_AMOUNT_CNY,
    stars: PACKAGE_STARS,
    payeeName: env.PAYEE_NAME || '站长',
    paymentTip: env.PAYMENT_TIP || '请扫码支付 5 元，并在付款备注中填写订单备注码或注册邮箱。',
    qrImage: '/pay-qrcode.png',
    fallbackQrImage: '/pay-qrcode-placeholder.svg'
  });
}

async function createOrder(context) {
  const { env } = context;
  const { user } = await requireUser(context);
  const body = await readJson(context.request);
  const amount = Number(body.amountCny ?? PACKAGE_AMOUNT_CNY);
  if (!PACKAGES.includes(amount)) return json({ error: '请选择有效的充值套餐' }, 400);
  const stars = amount * 20;
  const orderId = makeId('order');
  const memo = randomCode(8);
  const now = nowIso();

  await env.DB.prepare(`
    INSERT INTO orders (id, user_id, amount_cny, stars, status, memo, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).bind(orderId, user.id, amount, stars, memo, now).run();

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  return json({
    order: publicOrder(order),
    payMode: 'manual_qrcode',
    payeeName: env.PAYEE_NAME || '站长',
    paymentTip: `请支付 ¥${amount}（以订单金额为准），并在付款备注中填写 ${memo}。付款后提交审核，管理员核对实际到账金额。`,
    qrImage: '/pay-qrcode.png',
    fallbackQrImage: '/pay-qrcode-placeholder.svg',
    message: `订单已创建：${amount} 元人民币 = ${stars} 颗星星。请扫码付款后点击“我已付款”。`
  });
}

async function markOrderUserPaid(context, orderId) {
  const { env } = context;
  const { user } = await requireUser(context);
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').bind(orderId, user.id).first();
  if (!order) return json({ error: '订单不存在' }, 404);
  if (order.status === 'paid') return json({ order: publicOrder(order), user: safeUser(user) });
  if (order.status === 'rejected') return json({ error: '订单已被驳回，请重新创建订单' }, 400);

  const now = nowIso();
  await env.DB.prepare("UPDATE orders SET status = 'reviewing', reviewing_at = ? WHERE id = ? AND user_id = ? AND status != 'paid'").bind(now, orderId, user.id).run();
  const updated = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  return json({ order: publicOrder(updated), message: '已提交付款确认，请等待管理员审核到账。' });
}

async function listMyOrders(context) {
  const { env } = context;
  const { user } = await requireUser(context);
  const { results } = await env.DB.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(user.id).all();
  return json({ orders: results.map(publicOrder) });
}

async function adminListOrders(context) {
  requireAdmin(context);
  const { results } = await context.env.DB.prepare(`
    SELECT orders.*, users.email AS user_email
    FROM orders LEFT JOIN users ON users.id = orders.user_id
    ORDER BY orders.created_at DESC
    LIMIT 200
  `).all();
  return json({ orders: results.map(adminOrder) });
}

async function adminApproveOrder(context, orderId) {
  requireAdmin(context);
  const { env } = context;
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) return json({ error: '订单不存在' }, 404);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(order.user_id).first();
  if (!user) return json({ error: '用户不存在' }, 404);

  if (order.status !== 'paid') {
    const now = nowIso();
    const updateOrder = await env.DB.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ? AND status != 'paid'").bind(now, orderId).run();
    if ((updateOrder.meta?.changes ?? 0) > 0) {
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').bind(order.stars || PACKAGE_STARS, order.user_id),
        env.DB.prepare('INSERT INTO wallet_ledger (id, user_id, delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(makeId('ledger'), order.user_id, order.stars || PACKAGE_STARS, 'manual_payment_approved', order.id, now)
      ]);
    }
  }

  const updatedOrder = await env.DB.prepare(`
    SELECT orders.*, users.email AS user_email
    FROM orders LEFT JOIN users ON users.id = orders.user_id
    WHERE orders.id = ?
  `).bind(orderId).first();
  const updatedUser = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(order.user_id).first();
  return json({ order: adminOrder(updatedOrder), user: safeUser(updatedUser) });
}

async function adminRejectOrder(context, orderId) {
  requireAdmin(context);
  const { env } = context;
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) return json({ error: '订单不存在' }, 404);
  if (order.status !== 'paid') {
    await env.DB.prepare("UPDATE orders SET status = 'rejected', rejected_at = ? WHERE id = ?").bind(nowIso(), orderId).run();
  }
  const updatedOrder = await env.DB.prepare(`
    SELECT orders.*, users.email AS user_email
    FROM orders LEFT JOIN users ON users.id = orders.user_id
    WHERE orders.id = ?
  `).bind(orderId).first();
  return json({ order: adminOrder(updatedOrder) });
}

async function adminAddStars(context, userId) {
  requireAdmin(context);
  const body = await readJson(context.request);
  const stars = Number(body.stars);
  const reason = String(body.reason || '').trim().slice(0, 150);
  if (reason.length < 5) return json({ error: '请填写至少5个字的补发原因或订单号' }, 400);
  if (!Number.isFinite(stars) || stars <= 0 || stars > 100000) return json({ error: '星星数量不正确' }, 400);

  const user = await context.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  if (!user) return json({ error: '用户不存在' }, 404);
  const now = nowIso();
  await context.env.DB.batch([
    context.env.DB.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').bind(stars, userId),
    context.env.DB.prepare('INSERT INTO wallet_ledger (id, user_id, delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(makeId('ledger'), userId, stars, 'admin_add_stars:' + reason, makeId('manual'), now)
  ]);
  const updatedUser = await context.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  return json({ user: safeUser(updatedUser) });
}

async function consumeStar(context) {
  const { env, request } = context;
  const { user } = await requireUser(context);
  const body = await readJson(request);
  if (Number(user.stars || 0) < PROCESS_COST) return json({ error: '星星不足，请先充值' }, 402);

  const now = nowIso();
  const usageId = makeId('use');
  const filename = String(body.filename || '').slice(0, 200);
  const update = await env.DB.prepare('UPDATE users SET stars = stars - ? WHERE id = ? AND stars >= ?').bind(PROCESS_COST, user.id, PROCESS_COST).run();
  if ((update.meta?.changes ?? 0) === 0) return json({ error: '星星不足，请先充值' }, 402);

  await env.DB.batch([
    env.DB.prepare('INSERT INTO usages (id, user_id, cost, status, filename, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(usageId, user.id, PROCESS_COST, 'charged', filename, now),
    env.DB.prepare('INSERT INTO wallet_ledger (id, user_id, delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(makeId('ledger'), user.id, -PROCESS_COST, 'process_consume', usageId, now)
  ]);
  const updatedUser = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  return json({ usageId, user: safeUser(updatedUser) });
}

async function refundStar(context) {
  const { env, request } = context;
  const { user } = await requireUser(context);
  const body = await readJson(request);
  const usageId = String(body.usageId || '');
  const usage = await env.DB.prepare('SELECT * FROM usages WHERE id = ? AND user_id = ?').bind(usageId, user.id).first();
  if (!usage) return json({ error: '消耗记录不存在' }, 404);
  if (usage.status === 'refunded') {
    const current = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    return json({ user: safeUser(current), usage });
  }
  if (usage.status !== 'charged') return json({ error: '这个记录不能退回星星' }, 400);

  const now = nowIso();
  const updateUsage = await env.DB.prepare("UPDATE usages SET status = 'refunded', refunded_at = ? WHERE id = ? AND user_id = ? AND status = 'charged'").bind(now, usageId, user.id).run();
  if ((updateUsage.meta?.changes ?? 0) > 0) {
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').bind(usage.cost || PROCESS_COST, user.id),
      env.DB.prepare('INSERT INTO wallet_ledger (id, user_id, delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(makeId('ledger'), user.id, usage.cost || PROCESS_COST, 'process_refund', usageId, now)
    ]);
  }
  const updatedUser = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  return json({ user: safeUser(updatedUser), usage: { ...usage, status: 'refunded', refunded_at: now } });
}

async function requireUser({ request, env }) {
  const token = getToken(request);
  if (!token) throw new HttpError('请先登录', 401);

  const session = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first();
  if (!session) throw new HttpError('登录已失效，请重新登录', 401);
  if (Date.parse(session.expires_at) < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    throw new HttpError('登录已过期，请重新登录', 401);
  }
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.user_id).first();
  if (!user) throw new HttpError('账号不存在', 401);
  return { token, session, user };
}

function requireAdmin({ request, env }) {
  const password = String(request.headers.get('X-Admin-Password') || '');
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD === 'change-this-admin-password') {
    throw new HttpError('请先在 Cloudflare Pages 的 Variables and Secrets 中设置 ADMIN_PASSWORD', 500);
  }
  if (password !== env.ADMIN_PASSWORD) throw new HttpError('管理员密码错误', 401);
}

async function readJson(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch (_) {
    return {};
  }
}

function getToken(request) {
  const header = request.headers.get('Authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return '';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
  return `${prefix}_${randomHex(16)}`;
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomCode(len) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  let out = '';
  for (const b of arr) out += alphabet[b % alphabet.length];
  return out;
}

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

function hexToBytes(hex) {
  const clean = String(hex || '').replace(/[^0-9a-f]/gi, '');
  const arr = new Uint8Array(clean.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    stars: Number(user.stars || 0),
    createdAt: user.created_at
  };
}

function publicOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    amountCny: Number(order.amount_cny || PACKAGE_AMOUNT_CNY),
    stars: Number(order.stars || PACKAGE_STARS),
    status: order.status,
    createdAt: order.created_at,
    paidAt: order.paid_at || null,
    reviewingAt: order.reviewing_at || null,
    rejectedAt: order.rejected_at || null,
    memo: order.memo
  };
}

function adminOrder(order) {
  return {
    ...publicOrder(order),
    userEmail: order.user_email || '未知用户',
    userId: order.user_id
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}


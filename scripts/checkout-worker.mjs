// SHOPLINE 導轉式結帳的核心邏輯範例（Cloudflare Workers + D1）。已去識別，請依你的資料表調整。
// 重點：建 session 一次、302 導轉、Webhook 驗簽、payment/get 再確認、sessions/query 補查、原子入帳。
//
// 假設的 orders 表欄位：id, status('pending'|'paid'), amount(分以上單位自訂), session_id, session_url, paid_at, provider_trade_no
// 需要的 env：SHOPLINE_MERCHANT_ID, SHOPLINE_API_KEY, SHOPLINE_SIGN_KEY, PAYMENT_ENV('staging'|'production'), PUBLIC_BASE_URL, DB
const AMOUNT_MINOR = 9000; // NT$90 × 100：金額永遠由伺服器決定
const apiBase = env => env.PAYMENT_ENV === 'production' ? 'https://api.shoplinepayments.com' : 'https://api-sandbox.shoplinepayments.com';
const requestId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join(''); // ≤32 字元
const changes = result => result?.meta?.changes ?? result?.changes ?? 0;

export async function shoplineCall(env, path, payload, idempotentKey) {
  const headers = { 'Content-Type': 'application/json', merchantId: env.SHOPLINE_MERCHANT_ID, apiKey: env.SHOPLINE_API_KEY, requestId: requestId() };
  if (idempotentKey) headers.idempotentKey = idempotentKey; // ≤32 字元
  const response = await fetch(apiBase(env) + path, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw Object.assign(new Error('provider_error'), { status: 502, provider: data });
  return data;
}

/** 建立 session（每張訂單只建一次），回傳要 302 導轉的網址。 */
export async function createSession(env, request, order, { method, language, email }) {
  const person = { firstName: 'Customer', lastName: 'Shop', email }; // lastName 必填
  const address = { countryCode: 'TW', street: 'N/A' };               // 數位商品也必填
  const data = await shoplineCall(env, '/api/v1/trade/sessions/create', {
    referenceId: order.id, language: language === 'en' ? 'en' : 'zh-TW',
    amount: { value: AMOUNT_MINOR, currency: 'TWD' }, expireTime: 60,
    returnUrl: `${env.PUBLIC_BASE_URL}/thanks`, mode: 'regular',
    allowPaymentMethodList: [method === 'ApplePay' ? 'ApplePay' : 'CreditCard'],
    order: {
      products: [{ id: 'sku-1', name: 'Product', quantity: 1, amount: { value: AMOUNT_MINOR, currency: 'TWD' } }],
      shipping: { shippingMethod: 'digital', carrier: 'digital', personalInfo: person, address },
    },
    customer: { referenceCustomerId: order.id, personalInfo: person }, // 之後用它對應回訂單
    billing: { personalInfo: person, address },
    client: { ip: request.headers.get('CF-Connecting-IP') ?? '127.0.0.1' },
  }, order.id.slice(0, 32));
  const target = new URL(data.sessionUrl);
  if (target.protocol !== 'https:' || !target.hostname.endsWith('.shoplinepayments.com') || data.referenceId !== order.id || !data.sessionId)
    throw Object.assign(new Error('provider_error'), { status: 502 });
  await env.DB.prepare("UPDATE orders SET session_id=?, session_url=? WHERE id=? AND status='pending'").bind(data.sessionId, target.href, order.id).run();
  return target.href;
}
// GET /checkout/:id → return new Response(null, { status: 302, headers: { Location: await createSession(...) } })

/** 入帳前再向 SHOPLINE 查一次：狀態、歸屬、金額都對才標為已付款。重送安全（只有一次 changes===1）。 */
export async function settle(env, order, tradeOrderId, onPaid) {
  if (order.status !== 'pending' || !/^[A-Za-z0-9_-]{1,64}$/.test(tradeOrderId ?? '')) return;
  const trade = await shoplineCall(env, '/api/v1/trade/payment/get', { tradeOrderId });
  const paid = trade.payment?.paidAmount ?? trade.paidAmount ?? {};                  // 金額在 payment.paidAmount
  const mine = (order.session_id && trade.sessionId === order.session_id)           // 不要用 referenceOrderId（那是 RL… 編號）
    || trade.order?.customer?.referenceCustomerId === order.id;
  if (trade.status !== 'SUCCEEDED' || !mine || paid.value !== AMOUNT_MINOR || paid.currency !== 'TWD') return;
  const result = await env.DB.prepare("UPDATE orders SET status='paid', paid_at=?, provider_trade_no=? WHERE id=? AND status='pending'")
    .bind(Math.floor(Date.now() / 1000), tradeOrderId, order.id).run();
  if (changes(result) === 1) await onPaid?.(order); // 只在這裡寄信／發授權，重送不會重複
}

/** Webhook 沒到時的備援：App 查詢「待付款」訂單時呼叫。 */
export async function reconcile(env, order, onPaid) {
  if (order.status !== 'pending' || !order.session_id) return;
  const session = await shoplineCall(env, '/api/v1/trade/sessions/query', { sessionId: order.session_id });
  if (session.status !== 'SUCCEEDED') return;
  const ok = (session.paymentDetails ?? []).find(item => item.paymentStatus === 'SUCCEEDED' || item.status === 'SUCCEEDED');
  if (ok) await settle(env, order, ok.tradeOrderId, onPaid);
}

/** 可能出現訂單編號的欄位（實際 Webhook body 形狀未直接驗證，全部嘗試）。 */
export const orderCandidates = data => [data?.order?.customer?.referenceCustomerId, data?.referenceOrderId, data?.order?.referenceOrderId]
  .filter(v => typeof v === 'string' && v.length > 0);

/** POST /shopline/webhook（產品 Worker 版）。中樞已驗過簽，這裡再驗一次。 */
export async function handleWebhook(request, env, verifySignature, onPaid) {
  const timestamp = request.headers.get('timestamp') ?? '', sign = request.headers.get('sign');
  const raw = await request.text(); // 必須是原始字串
  if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return new Response('timestamp', { status: 401 });
  if (!await verifySignature(timestamp, raw, sign, env.SHOPLINE_SIGN_KEY)) return new Response('signature', { status: 401 });
  const event = JSON.parse(raw);
  if (event?.type !== 'trade.succeeded') return new Response('OK'); // 其他事件只確認收到
  const data = event.data ?? {};
  let order = null;
  for (const id of orderCandidates(data)) { order = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first(); if (order) break; }
  const sessionId = data.sessionId ?? data.order?.sessionId;
  if (!order && sessionId) order = await env.DB.prepare('SELECT * FROM orders WHERE session_id=?').bind(sessionId).first();
  if (order && order.status === 'pending') await settle(env, order, data.tradeOrderId, onPaid); // 查詢失敗會丟錯 → 回非 200，讓 SHOPLINE 重送
  return new Response('OK');
}

/** Webhook 驗簽：HMAC-SHA256(signKey, `${timestamp}.${rawBody}`) 十六進位，常數時間比對。 */
export async function verifyWebhookSignature(timestamp, raw, sign, signKey) {
  if (!/^[A-Fa-f0-9]{64}$/.test(sign ?? '')) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(signKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const expected = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${raw}`)))].map(n => n.toString(16).padStart(2, '0')).join('');
  const tag = await crypto.subtle.sign('HMAC', key, enc.encode(expected));
  return crypto.subtle.verify('HMAC', key, tag, enc.encode(sign.toLowerCase()));
}

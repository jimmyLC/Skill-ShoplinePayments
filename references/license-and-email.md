# 付款後寄信與單一裝置授權（選用）

適用於賣一次性授權的軟體（序號 + Email）。這是我們在 SHOPLINE 付款完成後加的兩件事。

## 付款後寄序號信（Cloudflare Email Sending）

- 後台：Cloudflare → Compute → Email Service → Email Sending → Onboard Domain，選你的網域。
  會自動加 `cf-bounce` 子網域的 MX、SPF、DKIM、DMARC；約 5–15 分鐘生效。目前是 Beta，需 Workers 付費方案。
- `wrangler.jsonc`：`"send_email": [{ "name": "EMAIL" }]`（每個 env 都要寫）。
- 寄信：`await env.EMAIL.send({ to, from: { email: 'contact@your-domain', name: 'Product' }, replyTo, subject, text, html })`。
  `from` 網域必須已 onboard，否則 `E_SENDER_NOT_VERIFIED`。
- 規則：
  - 只在**入帳那一刻**（`UPDATE … WHERE status='pending'` 的 `changes===1`）寄一次；用 `email_sent_at` 防重複。
  - 寄信失敗**不影響授權**，記著沒寄，排程（cron）每天補寄近 7 天內未寄出的。
  - 信件同時附純文字版；HTML 用表格與行內樣式；圖示用小圖（約 13 KB，168px），
    不要用 1 MB 的原圖。信箱常擋外部圖片，這是正常的。
  - 語言：App 建單時帶 `language`（`zh-Hant`／`en`），存在訂單，寄信與 SHOPLINE 付款頁都用它。
  - 序號是機密：信中提醒「任何人拿到 Email 與序號都能啟用」。

## 一組序號同時只有一台裝置

- App 送「這台機器的穩定識別碼的雜湊」（macOS：`IOPlatformUUID` 加 App 專用字串後 SHA-256；
  只送雜湊，伺服器還原不出硬體資料）。
- 訂單記錄 `active_device_hash`、`device_changed_at`。
- 兩種呼叫：
  - **背景檢查**（App 啟動時）`takeover=false`：本機是目前裝置 → OK；沒有綁定 → 綁定；已被別台取代 → `409 device_replaced`，App 變回 Free。**背景檢查永遠不搶走別台的授權。**
  - **使用者明確按「在這台啟用」** `takeover=true`：換成這台。24 小時內只能換一次，超過回 `429 device_change_limited`。
- 綁定與換機都用單一條件式 `UPDATE`（`WHERE active_device_hash IS NULL`、`…!=? AND (changed_at IS NULL OR changed_at<=?)`）
  檢查 `changes`，避免兩台同時搶。
- 付款成功後第一次由付款的那台查詢訂單時（帶 `X-Device-Id` header）自動綁定。
- 舊版 App（沒送裝置識別碼）過渡期放行，之後用旗標（例如 `REQUIRE_DEVICE=true`）回 `426 update_required`。
- 舊裝置離線時仍可使用，連線後下一次檢查才失效；這是刻意的取捨。

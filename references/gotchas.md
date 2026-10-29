# 症狀與對照表

| 症狀 | 原因 | 處理 |
|---|---|---|
| 付款成功、訂單卻一直「待付款」 | 用 `referenceOrderId` 比對；它是 SHOPLINE 的 `RL…` 編號 | 改用 `order.customer.referenceCustomerId`／`sessionId`；加 `sessions/query` 補查 |
| 查到成功但程式說金額不符 | 金額在 `payment.paidAmount`，不是最上層 | 讀 `trade.payment?.paidAmount ?? trade.paidAmount` |
| 收款中樞收到 Webhook 但沒轉給產品 | 依 `referenceOrderId` 的首字母判斷產品，卻是 `RL…` | 取 `order.customer.referenceCustomerId` 判斷 |
| 建單 400 `1004`，訊息 `order.shipping is required; billing.address is required` | 數位商品也要運送資料與帳單地址 | 填佔位值（見 `checkout.md`） |
| `2005 Access Denied` | 金鑰與 merchantId 不同組／複製到 ID 欄／環境混用 | 見 `sandbox-and-credentials.md` |
| 查 session 得 `1016 Record does not exist` | sessionId 不存在 | 這是正常的金鑰檢查結果，代表認證通過 |
| Apple Pay 付款頁紅字 `cannot be processed` | 付款頁網域第一次使用時才驗證 | 等 1–2 分鐘重建訂單再試；見 `apple-pay.md` |
| Webhook 簽章一直不符 | 用 parse 後再 stringify 的 body；或 payload 少了 `timestamp.` | 用原始 body 字串；`payload = timestamp + '.' + raw` |
| Webhook 重送造成重複寄信／重複發授權 | 沒做冪等 | 條件式 `UPDATE … WHERE status='pending'` 並檢查 `changes===1` |
| 後台 Webhook URL 填了 `https://https://…` | 欄位已預填 `https://` | 只貼主機與路徑 |
| 沙盒 Webhook 收不到 | 共用帳號的 URL 被改／URL 非 HTTPS／你的 Worker 回非 200 | 重看後台設定，確認端點回 200 |
| 訂單編號必須唯一（`1001 Order exist`） | `referenceId` 重複 | 用隨機訂單編號；重試用 `idempotentKey` |
| 退款 | 本專案數位商品不退款，客訴時到後台手動退 | 後台交易紀錄 → 訂單 → 退款；Webhook 會送 `trade.refund.*` |
| `requestId` 被拒 | 超過 32 字元 | 16 bytes 隨機轉 32 位十六進位 |

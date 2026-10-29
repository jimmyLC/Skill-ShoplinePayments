---
name: shopline-payments-integration
description: >
  USE WHEN: 在 Cloudflare Workers（或任何無伺服器後端）串接 SHOPLINE Payments 導轉式結帳、
  驗證 Webhook、處理 Apple Pay、查詢付款、做付款後發信與授權，或遇到官方文件與實際 API 不一致、
  2005 Access Denied、Apple Pay「cannot be processed」、付款成功但訂單沒入帳等問題。
  DO NOT USE WHEN: 其他金流（綠界、藍新、TapPay），或只需要 API 欄位表（請看官方文件）。
argument-hint: "[topic: checkout/webhook/apple-pay/sandbox/hub/gotchas]"
user-invocable: true
metadata:
  author: JimmyLC
  version: 1.0.0
  verified: "2026-10-29，正式環境，TWD，導轉式（redirect），信用卡與 Apple Pay"
  documentation: https://docs.shoplinepayments.com/
---

# SHOPLINE Payments 串接實戰筆記（導轉式 + Cloudflare Workers）

這份 skill 記錄一次**真的上線**的串接經驗：官方文件與社群 skill 寫的，和正式 API 實際行為有幾處不同，
照範例做會「付款成功但訂單沒入帳」。API 欄位表請看官方文件或
[boyonglin/shopline-payments-skill](https://github.com/boyonglin/shopline-payments-skill)；
這裡只放**文件沒寫、我們踩過、已用正式環境驗證**的事。

## 先看這 10 件事（最容易踩雷）

1. **`referenceOrderId` 不是你的訂單編號。** 用 Session 建立的付款，`payment/get` 回傳的 `referenceOrderId`
   是 SHOPLINE 自己產生的 `RL…` 編號。你的編號在 `order.customer.referenceCustomerId`（建單時自己放進去），
   另有 `sessionId` 可對應。用 `referenceOrderId` 比對會永遠對不上。
2. **付款金額在 `payment.paidAmount`**，不在最上層的 `paidAmount`。
3. **數位商品也必填 `order.shipping` 與 `billing.address`。** 錯誤碼 `1004`，訊息會直接列出缺哪個欄位
   （`order.shipping is required; billing.address is required`）。填佔位值即可，見 `references/checkout.md`。
4. **Webhook 簽章** = `HMAC-SHA256(signKey, "${timestamp}.${原始body}")`，十六進位；必須用**原始 body 字串**驗，
   不要 parse 再 stringify；時間戳（毫秒）容許 5 分鐘。
5. **一個 Webhook 對應一把 Sign Key，帳號最多 20 個 Webhook。** 多個產品共用一個商家帳號時，
   用「收款中樞」依訂單編號前綴轉發（`references/webhook-hub.md`）。
6. **不要信任 returnUrl 回跳或單一 Webhook。** 入帳前再呼叫 `payment/get` 確認：狀態、屬於這張訂單、金額。
   另外在 App／前端查詢待付款訂單時，用 `sessions/query` 主動補查（Webhook 沒到也能入帳）。
7. **Apple Pay 第一次可能失敗，約 1 分鐘後正常。** 後台「已啟用」不代表網域已驗證；
   SHOPLINE 付款頁網域在第一次使用時才自動驗證。見 `references/apple-pay.md`。
8. **`2005 Access Denied` = 金鑰和商店編號不是同一組。** 最常見：複製到「ID」欄而不是「Key」欄、
   用了別的帳號的 merchantId、沙盒與正式混用。`references/sandbox-and-credentials.md`。
9. **沒有副作用的金鑰檢查**：用不存在的 sessionId 呼叫 `sessions/query`。金鑰對 → `400 {"code":"1016"}`（查無資料）；
   金鑰錯 → `2005`。不會建立任何交易。
10. **`language` 只收 `en`、`zh-TW`**（已測；其他值未驗證）。導轉用 **HTTP 302**，不要 iframe 或 `window.open`。

## 流程（建議架構）

```
App/前端 ──POST /orders──▶ Worker：建單（金額由伺服器固定，不收前端金額）
App/前端 ──開 /checkout/:id?token=…──▶ Worker：呼叫 sessions/create（只建一次，存 sessionUrl）──302──▶ SHOPLINE 付款頁
SHOPLINE ──POST /shopline/webhook──▶（中樞）驗簽 ──▶ 產品 Worker：payment/get 再確認 ──▶ 標為已付款（單一原子 UPDATE）
App ──GET /orders/:id──▶ Worker：待付款時 sessions/query 補查 ──▶ 回傳授權
```

重點：
- 入帳用 `UPDATE … WHERE status='pending'`，並檢查 `changes===1`，才寄信／發授權（重送通知不會重複）。
- 驗簽正確的 Webhook，即使事件不處理也回 200；產品端暫時失敗（資料庫、查詢逾時）回非 200，讓 SHOPLINE 重送。
- `sessionUrl` 的主機必須以 `.shoplinepayments.com` 結尾才導轉，避免被竄改成釣魚網址。

## 文件索引

| 主題 | 檔案 |
|---|---|
| 建立結帳交易的實際必填欄位、金額、語言 | `references/checkout.md` |
| Webhook 驗簽、事件、重送與冪等、收款中樞 | `references/webhook-hub.md` |
| Apple Pay：條件、第一次失敗、怎麼診斷 | `references/apple-pay.md` |
| 沙盒與金鑰：共用帳號、2005、正式環境驗收 | `references/sandbox-and-credentials.md` |
| 付款後寄序號信、單一裝置授權（選用） | `references/license-and-email.md` |
| 錯誤與症狀對照表 | `references/gotchas.md` |
| 可直接改用的範例程式（已去識別） | `scripts/` |

## 驗收清單（正式環境）

- [ ] `sessions/query`（不存在的 id）回 `1016`，代表金鑰有效
- [ ] 建單 → 302 到 `pay.shoplinepayments.com`
- [ ] 信用卡真實小額付款 → 訂單變已付款（Webhook 或補查）
- [ ] Apple Pay 付款（Safari，錢包有卡）；第一次失敗就等 1 分鐘再試
- [ ] 重送同一個 Webhook → 不重複入帳、不重複寄信
- [ ] 竄改簽章、過期時間戳、金額不符、別張訂單 → 都不入帳
- [ ] 到 SHOPLINE 後台手動退款測試付款

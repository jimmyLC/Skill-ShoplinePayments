# 綁卡訂閱（內嵌 SDK + 每月自動扣款）

導轉式結帳（`sessions/create`）文件上沒有綁卡功能，**無法自動續扣**。要做月租訂閱，改用「內嵌 SDK 綁卡」，
由自己的排程每月對已綁定的卡扣款。已用正式環境驗證：首次付款、3D 驗證、綁卡、Webhook 入帳。
**未驗證**：第一次真實的 `Recurring` 續扣（請上線後盯第一個扣款日）。

## 流程

```
前端 ShoplinePayments({... bindCard}) 顯示卡片表單
  └ payment.createPayment() ─▶ paySession（不透明字串，卡號不經過你的伺服器）
前端 ──POST /checkout {paySession}──▶ 伺服器 POST /api/v1/trade/payment/create ─▶ nextAction
前端 payment.pay(nextAction) ─▶ SDK 自己跳 3D 驗證，再導回 returnUrl
SHOPLINE ──Webhook trade.succeeded──▶ 伺服器：payment/get 再確認 ─▶ 入帳、存 customerId + paymentInstrumentId
每日排程 ─▶ 到期的訂閱：payment/create（Recurring）─▶ 扣款結果由同步回應 + Webhook 確認
```

## SDK 初始化

```js
const { payment, error } = await window.ShoplinePayments({
  clientKey, merchantId, paymentMethod: 'CreditCard', currency: 'TWD', language: 'zh-TW',
  amount: 9900,                     // 單位：百分之一元（NT$99 = 9900）
  element: '#paymentContainer',
  env: 'production',                // 沙盒用 'sandbox'
  paymentInstrument: { bindCard: { enable: true, protocol: { switchVisible: false, defaultSwitchStatus: true } } },
});
```

`switchVisible:false` + `defaultSwitchStatus:true` = 不顯示「儲存卡片」開關，一律綁卡（訂閱必須）。

## 伺服器端兩種扣款

| | 首次 | 續扣 |
|---|---|---|
| 端點 | `POST /api/v1/trade/payment/create` | 同左 |
| `acquirerType` | `SDK` | `SDK` |
| `confirm.paymentBehavior` | `CardBindPayment` | `Recurring` |
| 卡片來源 | `paySession`（前端給的） | `paymentInstrument.paymentInstrumentId` + `paymentCustomerId`，`paySession:'{}'` |
| 其他 | `savePaymentInstrument:true` | `autoConfirm:true`；仍要帶付款人 IP |

標頭：`merchantId`、`apiKey`、`requestId`（32 字元）、`idempotentKey`（續扣用「訂單+期數+次數」，重送不會重複扣）。
其他端點：`/api/v1/trade/payment/get`（入帳前確認）、`/api/v1/customer/paymentInstrument/query`、
`/api/v1/customer/paymentInstrument/unbind`（取消訂閱與刪帳號時解綁）。

## 踩過的坑（都發生過）

1. **`payment.pay()` 之後不要自己換頁。** SDK 會自己導去銀行 3D 驗證再回 `returnUrl`；
   如果你在 `pay()` 回傳後立刻 `location.href = ...`，3D 被取消、付款失敗。
   做法：只顯示「正在前往銀行驗證」，另設 30 秒保底再導回。
2. **卡片表單一片灰色（骨架畫面不消失）= CSP 擋住。** 需要放行：
   `cdn.shoplinepayments.com`、`*.shoplinepayments.com`、`*.myshopline.com`、`*.myshoplinestg.com`、
   `h.online-metrix.net` 與 `*.online-metrix.net`（風控），涵蓋 `script-src`、`connect-src`、`frame-src`。
3. **`referenceOrderId` 用自己的單號。** 首次 = 訂閱單號；續扣 = `${單號}R${期數}A${第幾次}`。
   分隔字元用大寫 `R`、`A`，單號本身用小寫，解析時才不會誤切（單號的 base36 時間戳常含小寫 r、a）。
   `customerId` 用使用者 UUID 去掉 `-`（剛好 32 字元）。
4. **金額單位是百分之一元**（`toCents`），入帳比對也要用同一單位。
5. **每次續扣都需要付款人 IP。** 結帳時存下來、取消或結束時清掉。
6. **不要盲信 Webhook 或前端回跳。** `trade.succeeded` 收到後用 `payment/get` 再讀一次：
   狀態 `SUCCEEDED`、幣別與金額正確、單號能解析成我們的訂單，才入帳；入帳用 `INSERT OR IGNORE`（以交易編號為唯一鍵），重送不會重複。
7. **Webhook 事件**：`trade.succeeded`、`trade.failed`、`trade.customer_action`、`customer.instrument.binded`、`customer.instrument.unbinded`。
   使用者在 SHOPLINE 端解綁 → 收到 `unbinded`，把有效訂閱標為已取消。
8. **看到 `RL…` 開頭的交易**：多半是綁卡驗證用的小額授權，不是你的訂單；查後台確認是否已自動取消／退回。
9. 沒有沙盒也能直接上正式（用真卡小額），但**要先確認 3D 流程**，並提醒使用者會看到銀行驗證頁。

## 排程續扣設計（可直接照抄的規則）

- 訂單欄位：`provider`、`slp_customer_id`、`instrument_id`、`next_charge_at`、`charge_attempts`、`pending_trade_order_id`、`client_ip`。
- 到期權限寬限：成功後 `plan_until = 本次扣款 + 35 天`，下次扣款 `+30 天`（寬限 5 天給重試）。
- 每日排程撈 `status='active' AND next_charge_at <= now`；每筆先用**比較並更新**（compare-and-swap）搶 `charge_attempts`，避免兩個排程同時扣。
- 失敗隔天重試，最多 5 次，仍失敗 → 訂單結束、清掉 IP。
- 若 `pending_trade_order_id` 有值（上次結果不明），先 `payment/get` 查那一筆再決定，**不要直接再扣一次**。
- 取消：先解綁卡（`unbind`），解綁失敗但卡已無效視為成功；保留已付費期間的權益。
- Webhook 驗簽、5 分鐘時間容許、500 讓 SHOPLINE 重送，規則同 `webhook-hub.md`。

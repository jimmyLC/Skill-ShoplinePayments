# Skill-ShoplinePayments

SHOPLINE Payments 金流串接的**實戰筆記**，做成 [Agent Skill](https://docs.claude.com/en/docs/claude-code/skills) 格式。
來自一次真實上線（正式環境、TWD、導轉式結帳、信用卡與 Apple Pay）的串接經驗，重點是**官方文件與社群 skill 沒寫、
照做會出問題**的地方，例如：

- 付款成功但訂單沒入帳：`referenceOrderId` 其實是 SHOPLINE 的 `RL…` 編號，你的編號在 `order.customer.referenceCustomerId`
- 金額在 `payment.paidAmount`；數位商品也必填運送資料與帳單地址
- Webhook 驗簽、一個網域一個 Webhook 的「收款中樞」、Webhook 沒到時用 `sessions/query` 補查
- **Apple Pay 第一次失敗、1 分鐘後成功**的原因與診斷方法
- 沙盒是多人共用帳號、`2005 Access Denied` 怎麼查、不產生交易的金鑰檢查
- 付款後寄序號信（Cloudflare Email Sending）、一組序號同時一台裝置的授權

API 欄位表請看[官方文件](https://docs.shoplinepayments.com/)，或
[boyonglin/shopline-payments-skill](https://github.com/boyonglin/shopline-payments-skill)（本 repo 與它互補，內容獨立撰寫）。

## 內容

```
SKILL.md                              # 入口：10 個最容易踩雷的事、架構、驗收清單
references/checkout.md                # sessions/create 實際必填欄位、payment/get 實際回傳
references/webhook-hub.md             # 驗簽、處理規則、補查、收款中樞
references/apple-pay.md               # Apple Pay 學到的事
references/sandbox-and-credentials.md # 沙盒、金鑰、2005、正式環境驗收
references/license-and-email.md       # 付款後寄信、單一裝置授權
references/gotchas.md                 # 症狀對照表
scripts/checkout-worker.mjs           # Workers + D1 範例：建 session、入帳、補查、驗簽
scripts/webhook-hub.mjs               # 收款中樞範例
scripts/credential-probe.mjs          # 不產生交易的金鑰檢查
```

## 安裝

把整個資料夾放到 `~/.claude/skills/shopline-payments-integration/`（或專案的 `.claude/skills/`），
Claude Code 會在你問到 SHOPLINE 串接時自動使用。

## 驗證範圍與限制

- 驗證日期：2026-10-29；正式環境、導轉式、`TWD`、信用卡與 Apple Pay。
- **沒有直接抓到實際的 Webhook body 形狀**（`payment/get` 的形狀有驗證）。範例程式同時嘗試多個欄位並以 `sessionId` 備援，
  請在你的環境以真實通知確認。
- LINE Pay、街口、ATM、分期、內嵌式（SDK）、平台特店未涵蓋。
- 範例程式是改寫自實際專案的精簡版，**未附完整測試**；上線前請自行補單元測試與端對端驗收。
- 本專案與 SHOPLINE 無關，內容可能隨官方更新而過時，請以官方文件為準。

## 授權

MIT，見 [LICENSE](LICENSE)。

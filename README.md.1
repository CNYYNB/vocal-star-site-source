# 星声工坊 Cloudflare Pages 版（个人收款码 + 人工确认到账）

这是把原来的本地音频处理页面改成 Cloudflare Pages 可部署的网站版本：

- 前端：`public/index.html`
- 后台审核页：`public/admin.html`
- 后端接口：`functions/api/[[path]].js`
- 数据库：Cloudflare D1
- 充值方式：个人收款码人工审核
- 计费规则：5 元 = 100 颗星星；处理 1 首音乐扣 1 颗星星

音频文件仍在用户浏览器本地处理，不会上传到服务器。后端只保存账号、余额、订单、扣星记录。

---

## 1. 替换你的收款码

把你的微信或支付宝收款码图片放到：

```text
public/pay-qrcode.png
```

如果不放，网站会显示一个占位收款码提示图。

建议付款备注要求用户填写：

```text
订单备注码 或 注册邮箱
```

这样你在微信/支付宝收款记录里更容易核对订单。

---

## 2. 本地安装

```bash
npm install
```

复制本地变量文件：

```bash
cp .dev.vars.example .dev.vars
```

打开 `.dev.vars`，把后台密码改掉：

```env
ADMIN_PASSWORD="你的后台强密码"
```

---

## 3. 创建 D1 数据库

登录 Cloudflare：

```bash
npx wrangler login
```

创建数据库：

```bash
npm run db:create
```

命令会输出类似：

```toml
[[d1_databases]]
binding = "DB"
database_name = "vocal-star-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把输出里的 `database_id` 复制到 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "vocal-star-db"
database_id = "这里换成你的数据库 ID"
```

---

## 4. 初始化数据库表

本地测试数据库：

```bash
npm run db:migrate:local
```

正式线上数据库：

```bash
npm run db:migrate:remote
```

---

## 5. 本地运行测试

```bash
npm run dev
```

打开 Wrangler 给出的本地地址，通常是：

```text
http://localhost:8788
```

测试流程：

1. 注册账号。
2. 点击充值。
3. 页面显示收款码和订单备注码。
4. 用户点击“我已付款，提交审核”。
5. 打开 `/admin.html`。
6. 输入 `ADMIN_PASSWORD`。
7. 核对收款记录后点“确认到账”。
8. 用户余额增加 100 星。
9. 用户处理一首音乐扣 1 星。

---

## 6. 部署到 Cloudflare Pages

直接部署：

```bash
npm run deploy
```

部署后会得到一个 Cloudflare Pages 网址。

后台地址：

```text
https://你的域名/admin.html
```

---

## 7. 线上设置管理员密码

上线后必须在 Cloudflare Pages 项目里添加变量/密钥：

```text
ADMIN_PASSWORD = 你的后台强密码
```

也可以在 Cloudflare 后台设置：

```text
Workers & Pages → 选择你的 Pages 项目 → Settings → Variables and Secrets → Add
```

`PAYEE_NAME` 和 `PAYMENT_TIP` 可以放在 `wrangler.toml` 的 `[vars]` 里，也可以在 Cloudflare 后台设置。

---

## 8. 个人收款码充值流程

用户侧：

```text
注册/登录
→ 点击充值
→ 扫码支付 5 元
→ 付款备注写订单备注码或注册邮箱
→ 点击“我已付款，提交审核”
→ 等待到账
```

管理员侧：

```text
打开 /admin.html
→ 输入后台密码
→ 查看等待审核订单
→ 去微信/支付宝确认是否收到 5 元
→ 对应订单点击“确认到账”
→ 系统给用户加 100 星
```

---

## 9. 重要注意事项

1. 个人收款码无法真正自动到账，只能人工确认。
2. 不要把 `.dev.vars` 上传到 GitHub。
3. `ADMIN_PASSWORD` 一定要设置强密码。
4. 正式运营前，建议增加服务条款、隐私政策、退款说明。
5. 如果后续要自动到账，需要接入带支付回调的微信/支付宝商户支付或聚合支付。

---

## 10. 项目结构

```text
vocal_star_cloudflare_pages/
├─ public/
│  ├─ index.html
│  ├─ admin.html
│  └─ pay-qrcode-placeholder.svg
├─ functions/
│  └─ api/
│     └─ [[path]].js
├─ migrations/
│  └─ 0001_init.sql
├─ wrangler.toml
├─ .dev.vars.example
├─ package.json
└─ README.md
```

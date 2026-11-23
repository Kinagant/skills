---
name: image-translate
description: 把图片里的文字翻译成目标语言并保留原图排版。用户发来截图、商品图、漫画或文档图片，要求“翻译这张图”“把图里的英文换成中文”时使用。
metadata:
  version: 0.3.0
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/translate.mjs *)
---

# GlotFrame 图片翻译

把一张图片里的文字翻译成目标语言，保留原图排版，输出一张译图。翻译由 GlotFrame API 完成，按张计费。

## 什么时候用

- 用户给了一张截图 / 商品图 / 漫画 / 文档截图，要求翻译成中文、英文、日文等。
- 用户说“翻译这张图”“把图里的英文换成中文”，并给了本地文件、截图或图片链接。
- 需要 OCR + 翻译 + 回填排版一条龙。

不要用：纯文字翻译（直接翻就行）、需要还原可编辑文档结构、用户没给图片也没给链接。

## 前置：API Key

需要一个 GlotFrame API Key（`sk_gf_` 开头）。没有就让用户去
<https://app.glotframe.com/ApiKeys> 创建，**首次创建 Key 送 25 次免费翻译**。

Key 放在环境变量 `GLOTFRAME_API_KEY` 里，不要写进对话、代码或日志：

```powershell
# Windows PowerShell（当前窗口生效）
$env:GLOTFRAME_API_KEY = "sk_gf_xxx"
```

```bash
# macOS / Linux
export GLOTFRAME_API_KEY="sk_gf_xxx"
```

Key 缺失时停下来问用户，不要猜、不要用别人的 Key。

## 推荐：用随插件带的脚本

脚本在 `${CLAUDE_SKILL_DIR}/scripts/translate.mjs`，负责读文件、转 Base64、校验 20MB、处理错误、把译图下载到本地：

```bash
node ${CLAUDE_SKILL_DIR}/scripts/translate.mjs --image "<本地图片路径或图片 URL>" --lang zh
```

- 本地文件会走 `imageBase64`，公网链接会走 `imageUrl`，不用你判断。
- 默认把译图存到原图旁边，命名 `<原名>-translated.<扩展名>`；用 `--out <路径>` 指定位置。
- 成功后 stdout 输出 JSON：

```json
{
  "ok": true,
  "localPath": "C:\\Users\\me\\Desktop\\shot-translated.png",
  "imageUrl": "https://api.glotframe.com/results/2026/11/xxxx.png",
  "targetLang": "zh",
  "engine": "imgtrans",
  "elapsedMs": 6200,
  "duplicated": false,
  "requestId": "skill-3f9c2a7d51b84e60"
}
```

- 失败时 stderr 输出 JSON（`ok: false` + `status` / `title` / `detail` / `requestId`），退出码非 0。
- 其它参数：`--id <requestId>`（重试时复用）、`--timeout <秒>`（默认 240）、`--json`（只输出 JSON）。

**拿到结果后**：把 `localPath` 给用户（可直接打开/发送），需要预览时用
`![译图](<localPath>)`。`imageUrl` 只作为备用，服务端会清理。

## 没有 Node 时：直接调 API

接口：`POST https://api.glotframe.com/v1/translate`

请求头：

```
Authorization: Bearer $GLOTFRAME_API_KEY
Content-Type: application/json
X-Client: skill/image-translate
X-Client-Version: 0.3.0
```

`imageUrl` 与 `imageBase64` **二选一**（同时给时以 Base64 为准）：

```bash
curl -s https://api.glotframe.com/v1/translate \
  -H "Authorization: Bearer $GLOTFRAME_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Client: skill/image-translate" \
  -d '{"imageUrl":"https://example.com/a.png","targetLang":"zh","requestId":"req-0001-abcd"}'
```

本地图片转 Base64（Windows PowerShell）：

```powershell
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\a.png"))
$body = @{ imageBase64 = $b64; targetLang = "zh"; requestId = "skill-abcdef12345678" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.glotframe.com/v1/translate" `
  -Headers @{ Authorization = "Bearer $env:GLOTFRAME_API_KEY"; "X-Client" = "skill/image-translate" } `
  -ContentType "application/json" -Body $body
```

## 参数

| 字段 | 必填 | 说明 |
|---|---|---|
| `imageUrl` | 二选一 | 公网可访问的 http/https 图片地址，≤ 2048 字符 |
| `imageBase64` | 二选一 | 图片内容的 Base64（可带 `data:image/png;base64,` 前缀） |
| `targetLang` | 否 | 目标语言，默认 `zh`；常用 `zh` / `en` / `ja` / `ko` / `fr` / `de` / `es` / `ru` / `pt` / `th` |
| `requestId` | 否 | 幂等键，8–64 位；重试时复用，避免重复扣费 |

- 单张图片 ≤ 20MB，支持 PNG / JPG / WEBP / GIF。
- 源语言由服务端识别/配置；如果翻译方向明显不对，让用户确认目标语言。

## 返回

```json
{
  "status": "ok",
  "userId": 10086,
  "apiKeyTitle": "my-laptop",
  "idempotencyKey": "skill-3f9c2a7d51b84e60",
  "duplicated": false,
  "imageUrl": "https://api.glotframe.com/results/2026/11/xxxx.png",
  "targetLang": "zh",
  "engine": "imgtrans",
  "elapsedMs": 6200
}
```

`duplicated: true` 表示这次是幂等命中，没有重新翻译、没有重复扣费。
响应头还有 `X-Engine`、`X-Elapsed-Ms`、`X-RateLimit-Limit`、`X-RateLimit-Reset`。

## 费用

- 每成功翻译一张扣 1 次，从钱包次数扣减；次数永久有效。
- 参数错误、图片下载失败、Base64 损坏等发生在扣费之前，不扣费。
- 翻译或落盘阶段失败时，该次可能已经扣费，日志会按 `requestId` 记录，可凭 `requestId` 联系客服退回。
- **批量前先确认**：一次要翻很多张时，先告诉用户大概会消耗多少次，得到确认再批量执行。

## 错误处理

| 状态 | title | 含义 | 你要做的 |
|---|---|---|---|
| 400 | `image_required` / `invalid_image_url` / `invalid_image_base64` | 参数不对、Base64 损坏、格式不支持 | 检查文件和参数后重试，不要原样重发 |
| 401 | `unauthorized` | Key 无效或已吊销 | 让用户到控制台重新生成 Key |
| 402 | `insufficient_credits` | 余额不足 | 告诉用户充值：<https://app.glotframe.com/Wallet?tab=recharge>，**不要自动重试** |
| 404 | `translation_not_found` | 按 requestId 没查到结果 | 说明上次没有产出；可凭 requestId 联系客服补回，用户同意后再换新 id 重试 |
| 409 | `request_id_reused` | 该 requestId 已扣费，但结果取不到 | 见下方「409 处理」，**不要换新 requestId 直接重试** |
| 413 | `image_too_large` | 原图超过 20MB（URL 通道） | 让用户压缩后再传 |
| 429 | `api_key_daily_limit_exceeded` / 限流 | 触发每分钟 120 次或单 Key 日上限 | 按 `X-RateLimit-Reset` 等待后重试 |
| 502 | `image_fetch_failed` | 原图下载失败（链接过期、非图片、超时） | 让用户换一个可访问的链接或改传本地文件，不要反复重试 |
| 502 | `translate_failed` | 上游翻译失败 | 可以用同一 requestId 重试 1 次；仍失败让用户稍后再试 |

## 409 处理（重要）

`409` 说明这个 `requestId` 之前已经扣过费。先查结果：

```bash
curl -s https://api.glotframe.com/v1/translations/<requestId> \
  -H "Authorization: Bearer $GLOTFRAME_API_KEY"
```

- 返回 200：直接用返回的 `imageUrl`，不要重新翻译。
- 返回 404：告诉用户“这次已扣费但结果不可用，请把 requestId 提供给客服处理”，用户同意后再用新 requestId 重试——换新 id 会再扣一次。

## 重试与幂等

- 一次任务只生成一个 `requestId`；网络超时、5xx 重试时**复用**同一个 id。
- 脚本内部已经对网络错误自动重试 1 次，并复用同一个 id。
- 429 按 `X-RateLimit-Reset`（Unix 秒）退避，不要立刻重试。
- 402 不重试。

## 隐私与安全

- 不要把 `GLOTFRAME_API_KEY` 打印到对话、日志或代码里。
- 只翻译用户明确提供的图片；不要猜测或伪造图片地址。
- 提醒用户不要上传身份证、银行卡等敏感图片。
- 结果图默认保留 7 天，请及时转存；`imageUrl` 不是长期存储。

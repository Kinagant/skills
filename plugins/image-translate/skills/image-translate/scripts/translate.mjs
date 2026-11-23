#!/usr/bin/env node
/**
 * GlotFrame image-translate skill helper.
 *
 * Usage:
 *   node translate.mjs --image <path-or-url> [--lang zh] [--out <path>]
 *                      [--id <requestId>] [--timeout 240] [--json]
 *
 * Reads GLOTFRAME_API_KEY (required) and optional GLOTFRAME_API_BASE.
 * On success prints JSON to stdout; on failure prints JSON to stderr and exits 1.
 */

import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const VERSION = '0.3.0';
const MAX_BYTES = 20 * 1024 * 1024;
const API_BASE = (process.env.GLOTFRAME_API_BASE || 'https://api.glotframe.com').replace(/\/+$/, '');
const KEY = (process.env.GLOTFRAME_API_KEY || '').trim();

const HINTS = {
  400: '检查图片文件、Base64 内容和 targetLang 后重试，不要原样重发。',
  401: 'API Key 无效或已吊销，请到 https://app.glotframe.com/ApiKeys 重新生成。',
  402: '余额不足，请让用户充值：https://app.glotframe.com/Wallet?tab=recharge（不要自动重试）。',
  404: '按 requestId 没查到结果，说明上次没有产出，可以换新的 requestId 重试。',
  409: '该 requestId 已扣费但结果取不到。不要换新 requestId 重试（会再扣一次），请把 requestId 提供给客服。',
  413: '图片超过 20MB，请压缩后再传。',
  429: '触发限流或单 Key 日上限，按 X-RateLimit-Reset 等待后重试。',
  502: '上游或原图下载失败；链接过期时请让用户换链接或改传本地文件。'
};

function usage() {
  return [
    '用法: node translate.mjs --image <本地路径或图片URL> [--lang zh] [--out 路径]',
    '      [--id requestId] [--timeout 240] [--json]'
  ].join('\n');
}

function parseArgs(argv) {
  const args = { lang: 'zh', timeout: 240, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`缺少 ${a} 的参数值`);
      return v;
    };
    switch (a) {
      case '--image': case '-i': args.image = next(); break;
      case '--lang': case '-l': args.lang = next(); break;
      case '--out': case '-o': args.out = next(); break;
      case '--id': args.id = next(); break;
      case '--timeout': args.timeout = Number(next()); break;
      case '--json': args.json = true; break;
      case '--help': case '-h': args.help = true; break;
      default: throw new Error(`未知参数: ${a}`);
    }
  }
  return args;
}

function fail(payload) {
  const body = { ok: false, ...payload };
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

async function request(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(resp) {
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 500) }; }
}

async function lookup(requestId, timeoutMs) {
  const resp = await request(`${API_BASE}/v1/translations/${encodeURIComponent(requestId)}`, {
    headers: authHeaders()
  }, timeoutMs);
  if (resp.status === 404) return null;
  const body = await readJson(resp);
  if (!resp.ok) return null;
  return body;
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${KEY}`,
    'X-Client': 'skill/image-translate',
    'X-Client-Version': VERSION,
    ...extra
  };
}

function extFromContentType(ct) {
  const t = (ct || '').split(';')[0].trim().toLowerCase();
  if (t === 'image/jpeg') return '.jpg';
  if (t === 'image/webp') return '.webp';
  if (t === 'image/gif') return '.gif';
  if (t === 'image/png') return '.png';
  return '';
}

async function download(imageUrl, outPath, timeoutMs) {
  const resp = await request(imageUrl, {}, timeoutMs);
  if (!resp.ok) throw new Error(`下载译图失败 HTTP ${resp.status}`);

  const bytes = Buffer.from(await resp.arrayBuffer());
  const ext = extFromContentType(resp.headers.get('content-type')) || extname(new URL(imageUrl).pathname) || '.png';
  const finalPath = extname(outPath) ? outPath : outPath + ext;

  await mkdir(dirname(resolve(finalPath)), { recursive: true });
  await writeFile(finalPath, bytes);
  return resolve(finalPath);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    fail({ status: 0, title: 'bad_arguments', detail: e.message, hint: usage() });
  }

  if (args.help) {
    console.log(usage());
    return;
  }

  if (!KEY) {
    fail({
      status: 401,
      title: 'missing_api_key',
      detail: '环境变量 GLOTFRAME_API_KEY 未设置。',
      hint: HINTS[401] + ' 设置方法见 SKILL.md「前置：API Key」。'
    });
  }

  if (!args.image) {
    fail({ status: 0, title: 'missing_image', detail: '缺少 --image 参数。', hint: usage() });
  }

  const timeoutMs = Math.max(10, Number(args.timeout) || 240) * 1000;
  const isUrl = /^https?:\/\//i.test(args.image);
  const body = { targetLang: args.lang };
  const requestId = args.id || `skill-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  body.requestId = requestId;

  if (isUrl) {
    body.imageUrl = args.image;
  } else {
    const abs = isAbsolute(args.image) ? args.image : resolve(args.image);
    let info;
    try {
      info = await stat(abs);
    } catch {
      fail({ status: 0, title: 'image_not_found', detail: `本地文件不存在: ${abs}`, hint: '确认路径后重试。' });
    }
    if (!info.isFile()) fail({ status: 0, title: 'image_not_file', detail: `不是文件: ${abs}` });
    if (info.size > MAX_BYTES) {
      fail({ status: 413, title: 'image_too_large', detail: `图片 ${info.size} 字节，超过 20MB。`, hint: HINTS[413] });
    }
    body.imageBase64 = (await readFile(abs)).toString('base64');
    args._localInput = abs;
  }

  let resp;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      resp = await request(`${API_BASE}/v1/translate`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      }, timeoutMs);
      lastErr = null;
      // 网络层成功但 5xx：同一 requestId 重试一次
      if (resp.status >= 500 && attempt === 0) continue;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) continue;
    }
  }

  if (!resp) {
    fail({
      status: 0,
      title: 'network_error',
      detail: String(lastErr && lastErr.message ? lastErr.message : lastErr),
      requestId,
      hint: '检查网络后，用同一个 --id 重试。'
    });
  }

  const data = await readJson(resp);

  if (resp.status === 409) {
    const recovered = await lookup(requestId, timeoutMs);
    if (recovered && recovered.imageUrl) {
      data.imageUrl = recovered.imageUrl;
      data.duplicated = true;
    } else {
      fail({
        status: 409,
        title: data.title || 'request_id_reused',
        detail: data.detail || '该 requestId 已使用且结果不可用。',
        requestId,
        hint: HINTS[409]
      });
    }
  } else if (!resp.ok) {
    fail({
      status: resp.status,
      title: data.title || data.error || `http_${resp.status}`,
      detail: data.detail || data.raw || '',
      requestId,
      hint: HINTS[resp.status] || '按返回的 title/detail 处理后重试。'
    });
  }

  if (!data.imageUrl) {
    fail({ status: resp.status, title: 'empty_result', detail: '接口没有返回 imageUrl。', requestId });
  }

  let localPath = null;
  let downloadWarning = null;
  try {
    let out = args.out;
    if (!out) {
      const parsed = new URL(data.imageUrl);
      const ext = extname(parsed.pathname) || '.png';
      if (args._localInput) {
        const base = basename(args._localInput, extname(args._localInput));
        out = join(dirname(args._localInput), `${base}-translated${ext}`);
      } else {
        out = join(process.cwd(), `translated-${Date.now()}${ext}`);
      }
    }
    localPath = await download(data.imageUrl, out, Math.min(timeoutMs, 120000));
  } catch (e) {
    downloadWarning = `译图已生成但下载到本地失败：${e.message}`;
  }

  console.log(JSON.stringify({
    ok: true,
    localPath,
    imageUrl: data.imageUrl,
    targetLang: data.targetLang || args.lang,
    engine: data.engine || '',
    elapsedMs: data.elapsedMs ?? null,
    duplicated: Boolean(data.duplicated),
    requestId: data.idempotencyKey || requestId,
    ...(downloadWarning ? { warning: downloadWarning } : {})
  }, null, 2));
}

main().catch((e) => {
  fail({ status: 0, title: 'unexpected_error', detail: String(e && e.stack ? e.stack : e) });
});

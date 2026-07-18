const MODEL = "qwen-vl-ocr-latest";
const DASHSCOPE_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const MAX_BODY_BYTES = 7_000_000;
const ALLOWED_ORIGIN = "https://flamenwu.github.io";
const RATE_LIMIT = 6;
const RATE_WINDOW_MS = 60_000;
const requestsByIp = new Map();

function isAllowedOrigin(origin) {
  if (origin === ALLOWED_ORIGIN) return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin || "");
}

function responseHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "3600",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
  if (isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function jsonResponse(origin, body, statusCode = 200) {
  return {
    statusCode,
    headers: responseHeaders(origin),
    body: JSON.stringify(body),
  };
}

function collectText(value, target) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      collectText(JSON.parse(trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")), target);
    } catch {
      target.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, target));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.text === "string") {
    target.push(value.text.trim());
    return;
  }
  if (value.processed_text !== undefined) collectText(value.processed_text, target);
}

function extractOcrLines(body) {
  const lines = [];
  const content = body?.output?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    content.forEach((item) => {
      if (item?.ocr_result !== undefined) collectText(item.ocr_result, lines);
      else if (item?.text !== undefined) collectText(item.text, lines);
    });
  }
  return Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean)));
}

function extractIds(lines) {
  const ids = [];
  const seen = new Set();
  lines.forEach((line) => {
    const matches = line.match(/(?<!\d)\d{4,5}(?!\d)/g) || [];
    for (const match of matches) {
      const number = Number(match);
      if (number >= 1001 && number <= 13000) {
        const id = String(number);
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
  });
  return ids;
}

function allowRequest(ip) {
  const now = Date.now();
  const recent = (requestsByIp.get(ip) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    requestsByIp.set(ip, recent);
    return false;
  }
  recent.push(now);
  requestsByIp.set(ip, recent);
  return true;
}

async function recognizeImage(image, apiKey) {
  const upstream = await fetch(DASHSCOPE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: {
        messages: [
          {
            role: "user",
            content: [
              {
                image,
                min_pixels: 3072,
                max_pixels: 8388608,
                enable_rotate: true,
              },
            ],
          },
        ],
      },
      parameters: {
        ocr_options: { task: "advanced_recognition" },
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    console.error("DashScope OCR failed", upstream.status, body?.request_id || "", body?.code || "");
    throw new Error("UPSTREAM_FAILED");
  }
  return {
    requestId: body?.request_id || body?.requestId || "",
    lines: extractOcrLines(body),
  };
}

export const handler = async (event) => {
  let request;
  try {
    request = JSON.parse(Buffer.isBuffer(event) ? event.toString("utf8") : String(event));
  } catch {
    return jsonResponse("", { error: "请求数据无效。" }, 400);
  }

  const headers = Object.fromEntries(
    Object.entries(request.headers || {}).map(([key, value]) => [String(key).toLowerCase(), value]),
  );
  const origin = String(headers.origin || "");
  const method = String(request.requestContext?.http?.method || request.httpMethod || "GET").toUpperCase();

  if (method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) return jsonResponse(origin, { error: "来源不允许。" }, 403);
    return { statusCode: 204, headers: responseHeaders(origin), body: "" };
  }
  if (method === "GET") return jsonResponse(origin, { ok: true, model: MODEL });
  if (method !== "POST") return jsonResponse(origin, { error: "接口不存在。" }, 404);
  if (!isAllowedOrigin(origin)) return jsonResponse(origin, { error: "来源不允许。" }, 403);
  if (!process.env.DASHSCOPE_API_KEY) return jsonResponse(origin, { error: "识别服务尚未配置。" }, 503);

  const ip = String(request.requestContext?.http?.sourceIp || headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (!allowRequest(ip)) return jsonResponse(origin, { error: "拍照识别过于频繁，请一分钟后再试。" }, 429);

  let bodyText = String(request.body || "");
  if (request.isBase64Encoded) bodyText = Buffer.from(bodyText, "base64").toString("utf8");
  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    return jsonResponse(origin, { error: "照片过大，请重新拍摄。" }, 413);
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return jsonResponse(origin, { error: "照片数据无效。" }, 400);
  }
  const image = typeof payload?.image === "string" ? payload.image : "";
  if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(image)) {
    return jsonResponse(origin, { error: "只支持 JPG、PNG 或 WebP 照片。" }, 400);
  }
  if (image.length > MAX_BODY_BYTES) return jsonResponse(origin, { error: "照片过大，请重新拍摄。" }, 413);

  try {
    const result = await recognizeImage(image, process.env.DASHSCOPE_API_KEY);
    return jsonResponse(origin, {
      ok: true,
      model: MODEL,
      ids: extractIds(result.lines),
      lines: result.lines,
      requestId: result.requestId,
    });
  } catch (error) {
    if (error?.name === "TimeoutError") return jsonResponse(origin, { error: "识别超时，请稍后重试。" }, 504);
    return jsonResponse(origin, { error: "阿里千问识别暂时不可用，请稍后重试。" }, 502);
  }
};

// EdgeOne Pages Function —— 铁板神数条文「阿里千问」拍照 OCR 中转
// 路由：/api/ocr （与静态站同源，浏览器直接 fetch，无需处理跨域 CORS）
//
// 部署前需在 EdgeOne Pages 项目「环境变量」中配置：
//   DASHSCOPE_API_KEY = 你的通义千问 / DashScope API Key
//
// 逻辑与原 Aliyun FC(index.mjs) 完全一致，仅改为 Web 标准 API（Request/Response），
// 并去掉了硬编码的 ALLOWED_ORIGIN 限制（同源调用天然安全）。

const MODEL = "qwen-vl-ocr-latest";
const DASHSCOPE_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const MAX_BODY_BYTES = 7_000_000;
const RECOGNIZE_TIMEOUT_MS = 90_000;

// ---------- 以下解析逻辑与原 FC 保持一致（纯函数，无 Node 依赖） ----------

function collectText(value, target) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      collectText(
        JSON.parse(trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")),
        target
      );
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

async function recognizeImage(image, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECOGNIZE_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(DASHSCOPE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function onRequest(context) {
  const method = (context.request.method || "GET").toUpperCase();

  // 预检请求
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "3600",
      },
    });
  }

  // 健康检查（便于部署后验证函数是否在线）
  if (method !== "POST") {
    return json({ ok: true, model: MODEL });
  }

  const apiKey = context.env && context.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return json(
      { error: "识别服务尚未配置（请在 EdgeOne 项目环境变量中设置 DASHSCOPE_API_KEY）。" },
      503
    );
  }

  let bodyText;
  try {
    bodyText = await context.request.text();
  } catch {
    return json({ error: "请求数据无效。" }, 400);
  }
  if (bodyText.length > MAX_BODY_BYTES) {
    return json({ error: "照片过大，请重新拍摄。" }, 413);
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return json({ error: "照片数据无效。" }, 400);
  }
  const image = typeof payload?.image === "string" ? payload.image : "";
  if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(image)) {
    return json({ error: "只支持 JPG、PNG 或 WebP 照片。" }, 400);
  }

  try {
    const result = await recognizeImage(image, apiKey);
    return json({
      ok: true,
      model: MODEL,
      ids: extractIds(result.lines),
      lines: result.lines,
      requestId: result.requestId,
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      return json({ error: "识别超时，请稍后重试。" }, 504);
    }
    return json({ error: "阿里千问识别暂时不可用，请稍后重试。" }, 502);
  }
}

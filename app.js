const records = Array.isArray(window.TIAOWEN_DATA) ? window.TIAOWEN_DATA : [];
const byId = new Map(records.map((item) => [String(item.id).trim(), item]));
const ocrApiUrl = String(window.TIAOWEN_CONFIG?.ocrApiUrl || "").trim();

const form = document.querySelector("#query-form");
const input = document.querySelector("#query-input");
const resultPanel = document.querySelector("#result-panel");
const resultCard = document.querySelector("#result-card");
const resultId = document.querySelector("#result-id");
const resultText = document.querySelector("#result-text");
const resultDetail = document.querySelector("#result-detail");
const copyButton = document.querySelector("#copy-button");
const scanButton = document.querySelector("#scan-button");
const scanInput = document.querySelector("#scan-input");
const scanStatus = document.querySelector("#scan-status");
const scanPreview = document.querySelector("#scan-preview");
const scanManualForm = document.querySelector("#scan-manual-form");
const scanManualInput = document.querySelector("#scan-manual-input");
let scanPreviewUrl = "";

function normalizeId(value) {
  return String(value || "").replace(/[^0-9]/g, "").trim();
}

function isValidId(id) {
  const number = Number(id);
  return Number.isInteger(number) && number >= 1001 && number <= 13000;
}

function extractValidIds(text) {
  const ids = new Set();
  const matches = String(text || "").match(/\d{4,5}/g) || [];
  matches.forEach((part) => {
    const id = part.replace(/^0+/, "") || "0";
    if (isValidId(id) && byId.has(id)) ids.add(id);
  });
  return Array.from(ids).sort((a, b) => Number(a) - Number(b));
}

function findRecordsFromText(text) {
  return extractValidIds(text).map((id) => byId.get(id)).filter(Boolean);
}

function renderDetail(detail) {
  resultDetail.replaceChildren();
  String(detail || "")
    .split(/\r?\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const p = document.createElement("p");
      p.textContent = part;
      resultDetail.appendChild(p);
    });
}

function renderDetailInto(target, detail) {
  target.replaceChildren();
  String(detail || "")
    .split(/\r?\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const p = document.createElement("p");
      p.textContent = part;
      target.appendChild(p);
    });
}

function showRecord(record) {
  resultPanel.hidden = false;
  resultCard.hidden = false;
  resultId.textContent = `编号 ${record.id}`;
  resultText.textContent = record.text || "";
  renderDetail(record.detail || "");
  const url = new URL(window.location.href);
  url.searchParams.set("id", record.id);
  window.history.replaceState({}, "", url);
}

function showRecords(recordsToShow) {
  resultPanel.hidden = false;
  resultCard.hidden = false;
  resultId.textContent = `识别到 ${recordsToShow.length} 个编号`;
  resultText.textContent = "";
  resultDetail.replaceChildren();
  resultDetail.className = "record-list";

  recordsToShow.forEach((record) => {
    const item = document.createElement("section");
    item.className = "record-item";

    const id = document.createElement("p");
    id.className = "result-id";
    id.textContent = `编号 ${record.id}`;

    const title = document.createElement("h3");
    title.textContent = record.text || "";

    const detail = document.createElement("div");
    detail.className = "detail-text";
    renderDetailInto(detail, record.detail || "");

    item.append(id, title, detail);
    resultDetail.appendChild(item);
  });

  const url = new URL(window.location.href);
  url.searchParams.delete("id");
  url.searchParams.set("ids", recordsToShow.map((record) => record.id).join(","));
  window.history.replaceState({}, "", url);
}

function showEmpty() {
  resultPanel.hidden = true;
  resultCard.hidden = true;
  resultDetail.className = "detail-text";
}

function showRecordsFromText(text, emptyMessage) {
  const foundRecords = findRecordsFromText(text);
  if (!foundRecords.length) {
    showEmpty();
    setScanStatus(emptyMessage);
    return false;
  }

  input.value = foundRecords[0].id;
  showRecords(foundRecords);
  setScanStatus(`已找到 ${foundRecords.length} 个有效编号。`);
  scanManualForm.hidden = true;
  return true;
}

function lookup(value) {
  const id = normalizeId(value);
  input.value = id;
  resultDetail.className = "detail-text";
  if (!id) {
    showEmpty();
    return;
  }
  const record = byId.get(id);
  if (record) showRecord(record);
  else showEmpty();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  lookup(input.value);
});

input.addEventListener("input", () => {
  input.value = normalizeId(input.value);
});

copyButton.addEventListener("click", async () => {
  const text = `${resultId.textContent}\n${resultText.textContent}\n${Array.from(resultDetail.querySelectorAll("p, h3")).map((part) => part.textContent).join("\n")}`;
  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = "已复制";
    setTimeout(() => (copyButton.textContent = "复制条文"), 1200);
  } catch {
    copyButton.textContent = "复制失败";
    setTimeout(() => (copyButton.textContent = "复制条文"), 1200);
  }
});

function setScanStatus(message) {
  scanStatus.textContent = message;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("照片读取失败，请重新拍摄。"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("照片压缩失败，请重新拍摄。"));
    }, type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("照片读取失败，请重新拍摄。"));
    reader.readAsDataURL(blob);
  });
}

async function prepareImageForOcr(file) {
  if (/^image\/(?:png|jpe?g|webp)$/i.test(file.type || "") && file.size <= 5 * 1024 * 1024) {
    return blobToDataUrl(file);
  }
  const image = await loadImageFromFile(file);
  const maxSize = 3000;
  const scale = Math.min(maxSize / Math.max(image.naturalWidth, image.naturalHeight), 1);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.94);
  return blobToDataUrl(blob);
}

async function recognizeTextFromImage(file) {
  if (!ocrApiUrl) throw new Error("阿里千问识别服务尚未上线，请先使用手动编号查询。");
  setScanStatus("正在压缩照片并上传到阿里千问 OCR...");
  const image = await prepareImageForOcr(file);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 95_000);
  try {
    const response = await fetch(ocrApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
      credentials: "omit",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "阿里千问识别失败，请稍后重试。");
    const ids = Array.isArray(result.ids) ? result.ids : [];
    return ids.join("\n");
  } catch (error) {
    if (error.name === "AbortError") throw new Error("阿里千问识别超时，请稍后重试。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleScanFile(file) {
  if (!file) return;
  if (!String(file.type || "").startsWith("image/")) {
    setScanStatus("请选择照片文件。");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    setScanStatus("照片超过 20MB，请降低相机清晰度后重拍。");
    return;
  }

  scanButton.disabled = true;
  setScanStatus("正在准备照片...");
  if (scanPreviewUrl) URL.revokeObjectURL(scanPreviewUrl);
  scanPreviewUrl = URL.createObjectURL(file);
  scanPreview.src = scanPreviewUrl;
  scanPreview.hidden = false;

  try {
    const text = await recognizeTextFromImage(file);
    if (!showRecordsFromText(text, "没有自动识别到有效编号，请在下方手动输入纸上的编号。")) {
      scanManualForm.hidden = false;
      scanManualInput.focus();
      return;
    }
  } catch (error) {
    showEmpty();
    setScanStatus(error.message || "识别失败，请换清晰照片再试。");
    scanManualForm.hidden = false;
    scanManualInput.focus();
  } finally {
    scanButton.disabled = false;
    scanInput.value = "";
  }
}

scanButton.addEventListener("click", () => {
  scanInput.click();
});

scanInput.addEventListener("change", () => {
  handleScanFile(scanInput.files[0]);
});

scanManualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  showRecordsFromText(scanManualInput.value, "没有找到 1001 到 13000 之间的有效编号。");
});

const initialId = new URLSearchParams(window.location.search).get("id");
const initialIds = new URLSearchParams(window.location.search).get("ids");
if (initialIds) {
  const foundRecords = findRecordsFromText(initialIds);
  if (foundRecords.length) showRecords(foundRecords);
} else if (initialId) lookup(initialId);

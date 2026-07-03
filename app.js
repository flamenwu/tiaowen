const records = Array.isArray(window.TIAOWEN_DATA) ? window.TIAOWEN_DATA : [];
const byId = new Map(records.map((item) => [String(item.id).trim(), item]));

const form = document.querySelector("#query-form");
const input = document.querySelector("#query-input");
const totalCount = document.querySelector("#total-count");
const rangeLabel = document.querySelector("#range-label");
const emptyState = document.querySelector("#empty-state");
const resultCard = document.querySelector("#result-card");
const notFound = document.querySelector("#not-found");
const resultId = document.querySelector("#result-id");
const resultText = document.querySelector("#result-text");
const resultDetail = document.querySelector("#result-detail");
const copyButton = document.querySelector("#copy-button");

function normalizeId(value) {
  return String(value || "").replace(/[^0-9]/g, "").trim();
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

function showRecord(record) {
  emptyState.hidden = true;
  notFound.hidden = true;
  resultCard.hidden = false;
  resultId.textContent = `编号 ${record.id}`;
  resultText.textContent = record.text || "";
  renderDetail(record.detail || "");
  const url = new URL(window.location.href);
  url.searchParams.set("id", record.id);
  window.history.replaceState({}, "", url);
}

function showNotFound(id) {
  emptyState.hidden = true;
  resultCard.hidden = true;
  notFound.hidden = false;
  notFound.querySelector("p").textContent = id ? `没有找到编号 ${id}` : "请输入编号。";
}

function lookup(value) {
  const id = normalizeId(value);
  input.value = id;
  if (!id) {
    showNotFound("");
    return;
  }
  const record = byId.get(id);
  if (record) showRecord(record);
  else showNotFound(id);
}

function initSummary() {
  totalCount.textContent = records.length.toLocaleString("zh-CN");
  const ids = records.map((item) => Number(item.id)).filter(Number.isFinite);
  if (ids.length) {
    rangeLabel.textContent = `${Math.min(...ids)} - ${Math.max(...ids)}`;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  lookup(input.value);
});

input.addEventListener("input", () => {
  input.value = normalizeId(input.value);
});

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => lookup(button.dataset.example));
});

copyButton.addEventListener("click", async () => {
  const text = `${resultId.textContent}\n${resultText.textContent}\n${Array.from(resultDetail.querySelectorAll("p")).map((p) => p.textContent).join("\n")}`;
  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = "已复制";
    setTimeout(() => (copyButton.textContent = "复制"), 1200);
  } catch {
    copyButton.textContent = "复制失败";
    setTimeout(() => (copyButton.textContent = "复制"), 1200);
  }
});

initSummary();
const initialId = new URLSearchParams(window.location.search).get("id");
if (initialId) lookup(initialId);

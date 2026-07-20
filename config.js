window.TIAOWEN_CONFIG = Object.freeze({
  // 改为同源边缘函数路径：部署到 EdgeOne Pages 后，OCR 请求走 /api/ocr
  // 与原阿里云 FC 相比：同源请求、无 CORS 限制、国内边缘节点低延迟
  ocrApiUrl: "/api/ocr",
});

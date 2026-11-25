"use strict";

const byId = id => document.getElementById(id);
const number = new Intl.NumberFormat("zh-CN");
const format = value => number.format(value);
const labels = {
  complete_model_xml: "完整 · 模型 XML",
  complete_compiled_ir: "完整 · IR 编译",
  xml_only: "仅 XML",
  failed: "失败",
  interrupted: "中断",
};
const outputLabels = {
  model_ir: "模型 IR",
  compiler_ir: "编译器 IR",
  model_xml: "模型 XML",
  drawio: "验收 XML",
};
const providers = {hy: "HY", deepseek: "DeepSeek"};
const pageSize = 24;
const dialog = byId("detail");
const groups = [
  {name: "全部", accepts: () => true},
  {name: "完整", accepts: status => status.startsWith("complete_")},
  {name: "仅 XML", accepts: status => status === "xml_only"},
  {name: "失败／中断", accepts: status => status === "failed" || status === "interrupted"},
];
let records = [];
let group = 0;
let page = 0;
let activeCase = null;
let activeTrace = null;
let activeOutput = "";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pill(record) {
  return element("span", "status " + record.status, labels[record.status]);
}

function thumbnail(id) {
  return "./data/images/" + id + ".webp";
}

function caseCard(record, index) {
  const card = element("button", "card");
  card.type = "button";
  card.addEventListener("click", () => openCase(record));
  const visual = element("span", "card-image");
  const image = element("img");
  image.src = thumbnail(record.id);
  image.alt = "";
  image.loading = index < 4 ? "eager" : "lazy";
  image.decoding = "async";
  visual.append(image);
  const info = element("span", "card-body");
  const top = element("span", "card-top");
  top.append(element("span", "paper", record.paper), pill(record));
  info.append(top, element("span", "card-title", record.title),
    element("span", "card-model", providers[record.provider] || "模型记录缺失"));
  card.append(visual, info);
  return card;
}

function searchKey(value) {
  return value.normalize("NFKC").toLowerCase();
}

function showCases() {
  const queries = searchKey(byId("search").value.trim()).split(/\s+/).filter(Boolean);
  const provider = byId("provider").value;
  const filtered = records.filter(record => groups[group].accepts(record.status) &&
    (!provider || provider === record.provider) && queries.every(term => record.search.includes(term)));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  page = Math.min(page, pages - 1);
  const start = page * pageSize;
  byId("result-count").textContent = format(filtered.length) + " 条结果";
  const visible = filtered.slice(start, start + pageSize);
  byId("cases").replaceChildren(...(visible.length ? visible.map(caseCard) : [
    element("p", "empty", "没有匹配的图，试试缩短关键词或调整筛选。"),
  ]));
  byId("pagination").hidden = pages <= 1;
  byId("previous").disabled = page === 0;
  byId("next").disabled = page + 1 >= pages;
  byId("page-number").textContent = "第 " + format(page + 1) + " / " + format(pages) + " 页";
}

function updateSummary(data) {
  const total = records.length;
  const complete = records.filter(record => groups[1].accepts(record.status)).length;
  const rate = total ? 100 * complete / total : 0;
  byId("total").textContent = format(total);
  byId("complete").textContent = format(complete);
  byId("rate").textContent = rate.toFixed(1) + "%";
  byId("completion-bar").value = rate;
  byId("snapshot").textContent = data.date + " · 前 " + data.shards + " 个分片";
  const filters = byId("filters");
  groups.forEach((entry, index) => {
    const button = element("button", "", entry.name);
    button.type = "button";
    button.setAttribute("aria-pressed", String(index === group));
    button.append(element("span", "chip-count", format(records.filter(record => entry.accepts(record.status)).length)));
    button.addEventListener("click", () => {
      group = index;
      page = 0;
      Array.from(filters.children).forEach((child, position) => child.setAttribute("aria-pressed", String(position === group)));
      showCases();
    });
    filters.append(button);
  });
}

async function traceFor(id) {
  const response = await fetch("./data/traces/" + id + ".json.gz");
  if (!response.ok) throw new Error("轨迹文件请求失败");
  const bytes = await response.arrayBuffer();
  if (new Uint8Array(bytes, 0, 2)[0] !== 0x1f) return JSON.parse(new TextDecoder().decode(bytes));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json();
}

function traceStep(step, number, title, record) {
  const row = element("div", "step");
  const text = element("div");
  text.append(element("strong", "", title));
  const fields = [];
  const model = step.model || providers[step.provider || record.provider];
  if (model) fields.push(model);
  if (typeof step.seconds === "number") fields.push(step.seconds.toFixed(1) + " 秒");
  if (step.finish) fields.push(step.finish);
  text.append(element("p", "", fields.length ? fields.join(" · ") : "无请求回执"));
  if (step.usage) {
    const input = step.usage.input_tokens ?? step.usage.prompt_tokens;
    const output = step.usage.output_tokens ?? step.usage.completion_tokens;
    if (input !== undefined && output !== undefined) text.append(element("p", "", format(input) + " 输入 tokens · " + format(output) + " 输出 tokens"));
  }
  if (step.error) text.append(element("p", "", step.error));
  row.append(element("span", "step-index", number), text);
  return row;
}

function selectOutput(key) {
  activeOutput = key;
  byId("code").textContent = activeTrace?.outputs[key] || "这条轨迹没有保留输出。";
  byId("code").parentElement.scrollTop = 0;
  byId("copy").disabled = !activeTrace?.outputs[key];
  for (const node of byId("outputs").children) node.setAttribute("aria-pressed", String(node.dataset.output === key));
}

function loadedTrace(trace, record) {
  activeTrace = trace;
  const steps = byId("steps");
  const xmlInput = trace.outputs.compiler_ir
    ? (trace.ir_complete ? "参考图＋IR" : "参考图＋部分 IR")
    : "参考图";
  steps.replaceChildren(traceStep(trace.stages[0], "1", "参考图 → IR", record),
    traceStep(trace.stages[1], "2", xmlInput + " → XML", record));
  const details = [];
  if (record.status === "complete_compiled_ir") details.push("验收 XML 由 IR 编译生成");
  if (record.nodes !== null && record.nodes !== undefined) details.push(record.nodes + " 个节点");
  if (record.edges !== null && record.edges !== undefined) details.push(record.edges + " 条边");
  if (details.length) steps.append(element("p", "detail-meta", details.join(" · ")));
  const options = Object.keys(outputLabels).filter(key => Boolean(trace.outputs[key]));
  for (const key of options) {
    const button = element("button", "", outputLabels[key]);
    button.type = "button";
    button.dataset.output = key;
    button.addEventListener("click", () => selectOutput(key));
    byId("outputs").append(button);
  }
  selectOutput(options[0] || "");
  byId("render").disabled = !trace.outputs.drawio;
  byId("download").disabled = !trace.outputs.drawio;
}

async function openCase(record) {
  activeCase = record;
  activeTrace = null;
  byId("case-title").textContent = record.title;
  byId("case-meta").textContent = "arXiv " + record.paper + " · hkust-" + record.id;
  byId("case-status").className = "status " + record.status;
  byId("case-status").textContent = labels[record.status];
  byId("paper-link").href = record.arxiv;
  byId("image-link").href = thumbnail(record.id);
  byId("reference").src = thumbnail(record.id);
  byId("image-meta").textContent = "原图 " + record.size.join(" × ") + " px · 点击放大预览";
  byId("preview").hidden = true;
  byId("preview").replaceChildren();
  byId("steps").replaceChildren(element("p", "detail-meta", "正在载入轨迹…"));
  byId("outputs").replaceChildren();
  byId("code").textContent = "正在载入轨迹…";
  for (const id of ["render", "download", "copy"]) byId(id).disabled = true;
  const url = new URL(location.href);
  url.searchParams.set("case", record.id);
  history.replaceState(null, "", url);
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  try {
    const trace = await traceFor(record.id);
    if (activeCase === record && dialog.open) loadedTrace(trace, record);
  } catch (error) {
    if (activeCase === record && dialog.open) {
      byId("steps").replaceChildren(element("p", "detail-meta", error.message || "轨迹载入失败"));
      byId("code").textContent = "轨迹载入失败。";
    }
  }
}

function renderDrawio() {
  const xml = activeTrace?.outputs.drawio;
  if (!xml) return;
  const preview = byId("preview");
  if (preview.firstChild) {
    preview.scrollIntoView({block: "nearest"});
    return;
  }
  const frame = element("iframe");
  frame.title = "验收 XML 的 Draw.io 渲染";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.src = "./viewer.html";
  frame.addEventListener("load", () => frame.contentWindow.postMessage({xml}, "*"), {once: true});
  preview.hidden = false;
  preview.append(frame);
  preview.scrollIntoView({block: "nearest"});
}

function downloadDrawio() {
  const xml = activeTrace?.outputs.drawio;
  if (!xml) return;
  const url = URL.createObjectURL(new Blob([xml], {type: "application/xml"}));
  const link = element("a");
  link.href = url;
  link.download = "hkust-" + activeCase.id + ".drawio";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

byId("close").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  activeCase = null;
  byId("preview").replaceChildren();
  const url = new URL(location.href);
  url.searchParams.delete("case");
  history.replaceState(null, "", url);
});
byId("render").addEventListener("click", renderDrawio);
byId("download").addEventListener("click", downloadDrawio);
byId("copy").addEventListener("click", async () => {
  const button = byId("copy");
  try {
    await navigator.clipboard.writeText(activeTrace.outputs[activeOutput]);
    button.textContent = "已复制";
  } catch {
    button.textContent = "复制失败";
  }
  setTimeout(() => { button.textContent = "复制"; }, 1500);
});
for (const id of ["search", "provider"]) {
  byId(id).addEventListener(id === "search" ? "input" : "change", () => {
    page = 0;
    showCases();
  });
}
for (const [id, delta] of [["previous", -1], ["next", 1]]) {
  byId(id).addEventListener("click", () => {
    page += delta;
    showCases();
    byId("browse-title").scrollIntoView({block: "start"});
  });
}

async function start() {
  const response = await fetch("./data/index.json");
  if (!response.ok) throw new Error("索引请求失败");
  const data = await response.json();
  records = data.cases.map(record => ({
    ...record,
    search: searchKey([record.title, record.paper, "hkust-" + record.id].join(" ")),
  }));
  updateSummary(data);
  showCases();
  const caseId = new URL(location.href).searchParams.get("case");
  const record = records.find(entry => entry.id === caseId);
  if (record) openCase(record);
}

start().catch(() => { byId("result-count").textContent = "索引载入失败，请刷新后重试。"; });

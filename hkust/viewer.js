"use strict";

window.addEventListener("message", event => {
  if (event.source !== parent || typeof event.data?.xml !== "string") return;
  const diagram = document.getElementById("diagram");
  const message = document.getElementById("message");
  diagram.dataset.mxgraph = JSON.stringify({
    xml: event.data.xml,
    nav: true,
    resize: true,
    "auto-fit": true,
    "lightbox": false,
    toolbar: "zoom layers",
  });
  const script = document.createElement("script");
  script.src = "https://viewer.diagrams.net/js/viewer-static.min.js";
  script.addEventListener("load", () => { message.hidden = true; }, {once: true});
  script.addEventListener("error", () => { message.textContent = "渲染器载入失败。可以下载可编辑文件在 Draw.io 打开。"; }, {once: true});
  document.head.append(script);
}, {once: true});

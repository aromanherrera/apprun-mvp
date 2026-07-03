// ---- Global error console ----
(function() {
  var count = 0;
  function addError(type, msg, stack, extra) {
    var entries = document.getElementById('errorEntries');
    if (!entries) return;
    var placeholder = entries.querySelector('span');
    if (placeholder) placeholder.remove();
    count++;
    var badge = document.getElementById('errorBadge');
    if (badge) { badge.textContent = count; badge.style.display = 'inline'; }
    var details = document.getElementById('errorDetails');
    if (details) details.open = true;
    var time = new Date().toLocaleTimeString('es-ES', {hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
    var div = document.createElement('div');
    div.className = 'err-entry';
    var html = '<span class="err-time">' + time + '</span><span class="err-type">' + esc(type) + '</span><span class="err-msg">' + esc(msg) + '</span>';
    if (extra) html += '<div class="err-stack">' + esc(extra) + '</div>';
    if (stack && stack !== msg) html += '<div class="err-stack">' + esc(stack) + '</div>';
    div.innerHTML = html;
    entries.appendChild(div);
    entries.scrollTop = entries.scrollHeight;
  }
  function esc(s) {
    return (s||'').replace(/[&<>"']/g, function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
  }
  window.addEventListener('error', function(e) {
    var loc = (e.filename ? e.filename.replace(/.*\//, '') : '') + (e.lineno ? ':' + e.lineno : '');
    addError('JS ERROR', e.message, e.error && e.error.stack, loc || undefined);
  });
  window.addEventListener('unhandledrejection', function(e) {
    var reason = e.reason;
    var msg = reason instanceof Error ? reason.message : String(reason);
    addError('PROMISE', msg, reason instanceof Error ? reason.stack : undefined);
  });
  window.__logError = addError;
})();

(function () {
  const API_BASE    = "https://api1-soarplus-pre.es.deloitte.com";
  const API_TOKEN   = "sk-UmL4haDNvWZdQ4a8ZxKb3Q";
  const POLL_INTERVAL = 4000;

  const $ = id => document.getElementById(id);
  const state = { file: null, uploaded: false, polling: null, analysisType: null, lastResults: [] };
  window._archiaState = state;

  function authHeaders() { return { "Authorization": "Bearer " + API_TOKEN }; }

  // ---- Upload status helpers ----
  function setUploadStatus(html) {
    var el = $("uploadStatus");
    if (!el) return;
    el.style.display = "flex";
    el.innerHTML = html;
  }
  function spinner(msg) {
    return '<div class="spinner"></div><span class="status-text">' + escHtml(msg) + '</span>';
  }
  function checkIcon(msg) {
    return '<div class="check"><svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div><span class="status-text ok">' + escHtml(msg) + '</span>';
  }
  function errorIcon(msg) {
    return '<div class="x-icon" style="font-size:11px;color:#fff;font-weight:700">✕</div><span class="status-text err">' + escHtml(msg) + '</span>';
  }

  // ---- API Logger ----
  function log(type, data) {
    const entries = $("logEntries");
    if (!entries) return;
    const div = document.createElement("div");
    div.className = "log-entry " + type;
    const time = new Date().toLocaleTimeString("es-ES", { hour12:false, hour:"2-digit", minute:"2-digit", second:"2-digit" });
    let headHtml = "", bodyHtml = "";
    if (type === "log-req") {
      headHtml = '<span class="log-method">' + escHtml(data.method) + '</span><span class="log-url">' + escHtml(data.url) + '</span><span class="log-time">' + time + '</span>';
      const parts = [];
      if (data.headers) parts.push("Headers: " + JSON.stringify(data.headers, null, 2));
      if (data.body) parts.push("Body: " + data.body);
      bodyHtml = parts.join("\n\n");
    } else {
      const status = data.status ? " HTTP " + data.status : "";
      headHtml = '<span class="log-method">' + escHtml(data.label || "RESPONSE") + '</span><span class="log-url">' + escHtml(status) + ' ' + escHtml(data.url || "") + '</span><span class="log-time">' + (data.ms ? data.ms + "ms · " : "") + time + '</span>';
      bodyHtml = data.body || data.error || "";
    }
    div.innerHTML = '<div class="log-head">' + headHtml + '</div>' + (bodyHtml ? '<div class="log-body">' + escHtml(bodyHtml) + '</div>' : "");
    entries.appendChild(div);
    entries.scrollTop = entries.scrollHeight;
  }

  async function apiFetch(url, options) {
    options = options || {};
    const method = (options.method || "GET").toUpperCase();
    const headers = options.headers || {};
    let loggedBody = "";
    if (options.body instanceof FormData) {
      const parts = [];
      for (const [k, v] of options.body.entries()) {
        parts.push(k + ": " + (v instanceof File ? "[File: " + v.name + ", " + (v.size/1024).toFixed(0) + " KB]" : String(v)));
      }
      loggedBody = "FormData {\n  " + parts.join("\n  ") + "\n}";
    } else if (options.body) {
      loggedBody = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }
    log("log-req", { method, url, headers, body: loggedBody });
    const t0 = Date.now();
    try {
      const res = await fetch(url, options);
      const ms = Date.now() - t0;
      const bodyText = await res.text();
      const type = res.ok ? "log-res-ok" : "log-res-err";
      log(type, { label: res.ok ? "OK" : "ERROR", url, status: res.status, ms, body: bodyText.slice(0, 2000) });
      return { ok: res.ok, status: res.status, text: bodyText };
    } catch (e) {
      const ms = Date.now() - t0;
      let hint = "";
      if (e instanceof TypeError && e.message.includes("fetch")) {
        hint = "\n\nPosible causa: CORS. Usa Chrome con --disable-web-security o accede vía GitHub Pages.";
      }
      log("log-net-err", { label: "NET ERROR [" + e.constructor.name + "]", url, ms, error: e.message + hint });
      if (window.__logError) window.__logError("NET ERROR", e.message + hint, e.stack);
      throw e;
    }
  }

  // ---- Type selection ----
  window.selectType = function(type) {
    // Clear previous selection
    ["typeArquitectura","typeFormulario"].forEach(function(id) {
      $(id).classList.remove("selected");
    });
    $(type === "arquitectura" ? "typeArquitectura" : "typeFormulario").classList.add("selected");
    state.analysisType = type;

    // Reset sub-steps
    resetSubSteps();

    // Show upload step
    $("stepUpload").style.display = "block";

    if (type === "arquitectura") {
      $("uploadDesc").textContent = "Adjunta el documento de arquitectura a analizar. Formatos admitidos: .doc, .docx, .pdf";
      $("stepOpciones").style.display = "none"; // shown after upload confirms
      $("executeStepLabel").textContent = "Paso 4";
    } else {
      $("uploadDesc").textContent = "Adjunta el cuestionario o formulario de seguridad a analizar. Formatos admitidos: .doc, .docx, .pdf";
      $("stepOpciones").style.display = "none";
      $("executeStepLabel").textContent = "Paso 3";
    }

    $("stepEjecutar").style.display = "none"; // shown after upload confirms
    $("stepUpload").scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ---- File selection ----
  const dropZone = $("dropZone");
  const fileInput = $("fileInput");

  dropZone.addEventListener("click", () => fileInput.click());
  ["dragenter","dragover"].forEach(function(ev) {
    dropZone.addEventListener(ev, function(e) { e.preventDefault(); dropZone.classList.add("over"); });
  });
  ["dragleave","drop"].forEach(function(ev) {
    dropZone.addEventListener(ev, function(e) { e.preventDefault(); dropZone.classList.remove("over"); });
  });
  dropZone.addEventListener("drop", function(e) {
    var f = e.dataTransfer.files[0];
    if (f) setFile(f);
  });
  fileInput.addEventListener("change", function() {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
  });
  $("btnRemove").addEventListener("click", resetSubSteps);

  function setFile(f) {
    try {
      if (window.__logError) window.__logError('INFO', 'Fichero seleccionado: ' + f.name + ' (' + f.size + ' bytes)');
      var allowed = [".doc", ".docx", ".pdf", ".md"];
      var ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
      if (!allowed.includes(ext)) {
        setUploadStatus(errorIcon("Formato no admitido: " + ext + ". Usa .doc, .docx o .pdf"));
        $("fileInfo").style.display = "none";
        dropZone.style.display = "";
        return;
      }
      state.file = f;
      state.filename = f.name;
      state.uploaded = false;
      $("fileName").textContent = f.name + "  (" + (f.size / 1024).toFixed(0) + " KB)";
      $("fileInfo").style.display = "flex";
      dropZone.style.display = "none";
      $("btnPlaybook").disabled = true;
      uploadFile(f);
    } catch(e) {
      if (window.__logError) window.__logError('setFile ERROR', e.message, e.stack);
      setUploadStatus(errorIcon("Error procesando fichero: " + e.message));
    }
  }

  // ---- Upload ----
  async function uploadFile(f) {
    setUploadStatus(spinner("Subiendo fichero…"));
    try {
      var fd = new FormData();
      fd.append("file", f);
      var res = await apiFetch(API_BASE + "/datasource/uploadfile/", {
        method: "POST",
        headers: authHeaders(),
        body: fd
      });
      if (!res.ok) throw new Error("HTTP " + res.status + (res.text ? " – " + res.text.slice(0, 120) : ""));
      setUploadStatus(spinner("Fichero enviado. Verificando disponibilidad…"));
      startPolling(f.name);
    } catch (e) {
      setUploadStatus(errorIcon("Error al subir: " + e.message));
    }
  }

  // ---- Poll until file appears ----
  function startPolling(filename) {
    clearInterval(state.polling);
    state.polling = setInterval(async function() {
      try {
        var res = await apiFetch(API_BASE + "/datasource/listfiles/", { headers: authHeaders() });
        if (!res.ok) return;
        var data = null;
        try { data = JSON.parse(res.text); } catch (_) {}
        if (fileFoundInList(data, filename)) {
          clearInterval(state.polling);
          state.uploaded = true;
          setUploadStatus(checkIcon("Fichero disponible en la plataforma: " + filename));

          // Show options step only for arquitectura
          if (state.analysisType === "arquitectura") {
            $("stepOpciones").style.display = "block";
            $("optArqPub").disabled = false;
            $("optArqNav").disabled = false;
          }

          // Always show execute step
          $("stepEjecutar").style.display = "block";
          $("btnPlaybook").disabled = false;
        }
      } catch (_) {}
    }, POLL_INTERVAL);
  }

  function fileFoundInList(data, filename) {
    if (!data) return false;
    var list = Array.isArray(data) ? data : (data.files || data.data || data.results || []);
    return list.some(function(item) {
      if (typeof item === "string") return item === filename || item.endsWith("/" + filename);
      return (item.name || item.filename || item.file_name || "") === filename;
    });
  }

  // ---- Playbook execute ----
  $("btnPlaybook").addEventListener("click", async function() {
    if (!state.file || !state.uploaded) return;
    $("btnPlaybook").disabled = true;
    $("playbookStatus").textContent = "";
    $("resultCard").style.display = "block";
    $("resultBox").style.display = "none";
    $("resultSpinner").style.display = "flex";
    $("resultCard").scrollIntoView({ behavior: "smooth", block: "start" });

    if (state.analysisType === "formulario") {
      await runFormulario();
    } else {
      await runArquitectura();
    }

    $("btnPlaybook").disabled = false;
  });

  // ---- Formulario flow ----
  async function runFormulario() {
    var query = "poner en {cuestionario} el fichero con el nombre " + state.file.name;
    var results = await Promise.allSettled([
      invokePlaybook("sep-01scoping-secarch", query)
    ]);
    renderResults(results, ["Análisis de formulario"]);
  }

  // ---- Arquitectura flow ----
  async function runArquitectura() {
    var query = "incluye en la variable {documentos} el fichero denominado " + state.file.name;
    var doArqPub = $("optArqPub").classList.contains("selected");
    var doArqNav = $("optArqNav").classList.contains("selected");

    var jobs = [invokePlaybook("analisis-de-diseno-inicial-de-arquitectura", query)];
    var labels = ["Marcos de controles"];

    if (doArqPub) { jobs.push(invokePlaybook("revarquitectura", query)); labels.push("Arquitectura de publicación"); }
    if (doArqNav) { jobs.push(invokePlaybook("revarquitectura", query)); labels.push("Arquitectura de navegación"); }

    var results = await Promise.allSettled(jobs);
    renderResults(results, labels);
  }

  function renderResults(results, labels) {
    var bodyHtml = "";
    state.lastResults = [];
    results.forEach(function(r, i) {
      if (results.length > 1) {
        bodyHtml += '<div class="result-section-title"' + (i > 0 ? ' style="margin-top:32px"' : '') + '>' + labels[i] + '</div>';
      }
      if (r.status === "fulfilled") {
        bodyHtml += r.value.html;
        state.lastResults.push({ label: labels[i], text: r.value.text });
      } else {
        bodyHtml += '<p style="color:var(--red)">Error: ' + escHtml(r.reason && r.reason.message || String(r.reason)) + '</p>';
        state.lastResults.push({ label: labels[i], text: null });
      }
    });
    var kpiHtml = buildKpiHtml(bodyHtml);
    $("resultSpinner").style.display = "none";
    $("resultBox").style.display = "block";
    $("resultBox").className = "result-body";
    $("resultBox").innerHTML = kpiHtml + bodyHtml;
    $("btnDownloadWord").style.display = state.lastResults.some(function(r){ return r.text; }) ? "inline-block" : "none";
  }

  // ---- Invoke playbook → returns {html, text} ----
  async function invokePlaybook(playbookName, query) {
    var res = await apiFetch(
      API_BASE + "/playbooks/invoke/" + playbookName,
      {
        method: "POST",
        headers: Object.assign({}, authHeaders(), { "Content-Type": "application/json" }),
        body: JSON.stringify({ query: query })
      }
    );
    if (!res.ok) throw new Error("HTTP " + res.status + " – " + res.text.slice(0, 200));
    var json;
    try { json = JSON.parse(res.text); } catch(_) { throw new Error("Respuesta no es JSON: " + res.text.slice(0, 200)); }
    var taskId = json.id || json.task_id || json.taskId || (json.status && json.status.id) || null;
    if (!taskId) throw new Error("No se encontró ID de tarea: " + JSON.stringify(json).slice(0, 300));
    return pollTask(taskId);
  }

  // ---- Poll task → returns {html, text} ----
  function pollTask(taskId) {
    return new Promise(function(resolve, reject) {
      var url = API_BASE + "/agents/callagent-orchestrator/task/" + taskId;
      var attempts = 0;
      var maxAttempts = 120;

      function scheduleNext() {
        if (attempts >= maxAttempts) { reject(new Error("Tiempo de espera agotado (ID: " + taskId + ")")); return; }
        setTimeout(checkTask, 5000);
      }

      async function checkTask() {
        attempts++;
        try {
          var res = await apiFetch(url, { headers: authHeaders() });
          if (!res.ok) { scheduleNext(); return; }
          var data;
          try { data = JSON.parse(res.text); } catch(_) { scheduleNext(); return; }
          var statusObj = data.status || data;
          var taskState = (statusObj.state || statusObj.status || "").toLowerCase();
          if (taskState === "working" || taskState === "pending" || taskState === "running" || taskState === "") {
            scheduleNext(); return;
          }
          if (taskState === "completed" || taskState === "done" || taskState === "success") {
            var text = extractText(statusObj);
            var html = text ? renderMarkdown(text) : '<pre style="white-space:pre-wrap;font-size:12px;color:var(--gray-700)">' + escHtml(JSON.stringify(data, null, 2)) + '</pre>';
            resolve({ html: html, text: text || JSON.stringify(data, null, 2) });
            return;
          }
          if (taskState === "failed" || taskState === "error") {
            reject(new Error(extractText(statusObj) || JSON.stringify(data, null, 2))); return;
          }
          scheduleNext();
        } catch(e) { scheduleNext(); }
      }
      checkTask();
    });
  }

  // ---- Reset ----
  $("btnReset").addEventListener("click", resetAll);

  function resetSubSteps() {
    clearInterval(state.polling);
    state.file = null;
    state.uploaded = false;
    fileInput.value = "";
    $("fileInfo").style.display = "none";
    $("uploadStatus").style.display = "none";
    $("uploadStatus").innerHTML = "";
    dropZone.style.display = "";
    $("btnPlaybook").disabled = true;
    $("playbookStatus").textContent = "";
    $("stepOpciones").style.display = "none";
    $("stepEjecutar").style.display = "none";
    $("resultCard").style.display = "none";
    $("resultSpinner").style.display = "none";
    $("resultBox").style.display = "none";
    $("resultBox").innerHTML = "";
    var btnW = $("btnDownloadWord"); if (btnW) btnW.style.display = "none";
    ["optArqPub","optArqNav"].forEach(function(id) {
      var el = $(id); if (el) { el.disabled = true; el.classList.remove("selected"); }
    });
  }

  function resetAll() {
    resetSubSteps();
    state.analysisType = null;
    ["typeArquitectura","typeFormulario"].forEach(function(id) { $(id).classList.remove("selected"); });
    $("stepUpload").style.display = "none";
  }

  // ---- Helpers ----
  function extractText(statusObj) {
    var msg = statusObj.message;
    if (!msg) return null;
    var parts = msg.parts || msg.content || [];
    var texts = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p && (p.kind === "text" || p.type === "text") && p.text) texts.push(p.text);
    }
    if (texts.length) return texts.join("\n\n");
    if (typeof msg === "string") return msg;
    return null;
  }

  function escHtml(s) {
    return (s || "").replace(/[&<>"']/g, function(c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function inlineRender(text) {
    return text
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  }

  function statusBadge(raw) {
    var v = raw.trim();
    var lo = v.toLowerCase();
    if (lo === "sí" || lo === "si" || lo === "yes" || lo === "aplica" || lo === "✓")
      return '<span class="badge badge-si">' + escHtml(v) + '</span>';
    if (lo === "no")
      return '<span class="badge badge-no">' + escHtml(v) + '</span>';
    if (lo === "n/a" || lo === "na" || lo === "no aplica" || lo === "no aplicable" || lo === "no aplica")
      return '<span class="badge badge-na">' + escHtml(v) + '</span>';
    if (lo === "parcial" || lo === "parcialmente")
      return '<span class="badge badge-parcial">' + escHtml(v) + '</span>';
    if (lo === "alto" || lo === "crítico")
      return '<span class="badge badge-alto">' + escHtml(v) + '</span>';
    if (lo === "medio" || lo === "moderado")
      return '<span class="badge badge-medio">' + escHtml(v) + '</span>';
    if (lo === "bajo")
      return '<span class="badge badge-bajo">' + escHtml(v) + '</span>';
    return inlineRender(v);
  }

  function renderMarkdown(md) {
    var lines = md.split("\n"), out = [], inTable = false, tableRows = [];
    function flushTable() {
      if (!tableRows.length) return;
      var header = tableRows[0], body = tableRows.slice(2);
      var html = '<div class="tbl-wrap"><table><thead><tr>';
      html += header.map(function(c){ return "<th>" + inlineRender(c) + "</th>"; }).join("");
      html += "</tr></thead><tbody>";
      body.forEach(function(row, ri){
        html += "<tr>" + row.map(function(c, ci){
          var content = (ci > 0) ? statusBadge(c) : inlineRender(c);
          return "<td>" + content + "</td>";
        }).join("") + "</tr>";
      });
      html += "</tbody></table></div>";
      out.push(html); tableRows = []; inTable = false;
    }
    lines.forEach(function(line) {
      if (line.trim().startsWith("|")) {
        inTable = true;
        tableRows.push(line.split("|").slice(1,-1).map(function(c){ return c.trim(); }));
        return;
      }
      if (inTable) flushTable();
      if (/^### /.test(line)) { out.push("<h3>" + inlineRender(line.slice(4)) + "</h3>"); return; }
      if (/^## /.test(line))  { out.push("<h2>" + inlineRender(line.slice(3)) + "</h2>"); return; }
      if (/^# /.test(line))   { out.push("<h1>" + inlineRender(line.slice(2)) + "</h1>"); return; }
      if (/^---+$/.test(line.trim())) { out.push("<hr>"); return; }
      if (/^[-*] /.test(line)) { out.push("<ul><li>" + inlineRender(line.slice(2)) + "</li></ul>"); return; }
      if (/^\d+\. /.test(line)) { out.push("<ol><li>" + inlineRender(line.replace(/^\d+\. /,"")) + "</li></ol>"); return; }
      if (line.trim() === "") { out.push("<br>"); return; }
      out.push("<p>" + inlineRender(line) + "</p>");
    });
    if (inTable) flushTable();
    return out.join("\n").replace(/<\/ul>\n<ul>/g,"").replace(/<\/ol>\n<ol>/g,"");
  }

  function buildKpiHtml(htmlContent) {
    var tmp = document.createElement("div");
    tmp.innerHTML = htmlContent;
    var si = tmp.querySelectorAll(".badge-si").length;
    var no = tmp.querySelectorAll(".badge-no").length;
    var na = tmp.querySelectorAll(".badge-na").length;
    var parcial = tmp.querySelectorAll(".badge-parcial").length;
    var total = si + no + na + parcial;
    if (total === 0) return "";
    function pct(n) { return total > 0 ? Math.round(n/total*100) + "%" : "—"; }
    return '<div class="kpi-row">' +
      '<div class="kpi-card kpi-total"><div class="kpi-label">Total controles</div><div class="kpi-value">' + total + '</div></div>' +
      (si    ? '<div class="kpi-card kpi-si"><div class="kpi-label">Aplicables</div><div class="kpi-value">' + si + '</div><div class="kpi-pct">' + pct(si) + ' del total</div></div>' : '') +
      (no    ? '<div class="kpi-card kpi-no"><div class="kpi-label">No aplican</div><div class="kpi-value">' + no + '</div><div class="kpi-pct">' + pct(no) + ' del total</div></div>' : '') +
      (na    ? '<div class="kpi-card kpi-na"><div class="kpi-label">N/A</div><div class="kpi-value">' + na + '</div><div class="kpi-pct">' + pct(na) + ' del total</div></div>' : '') +
      (parcial ? '<div class="kpi-card kpi-parcial"><div class="kpi-label">Parcial</div><div class="kpi-value">' + parcial + '</div><div class="kpi-pct">' + pct(parcial) + ' del total</div></div>' : '') +
      '</div>';
  }

})();

function toggleOpt(btn) {
  btn.classList.toggle("selected");
}

// ---- Word report generation ----
async function downloadWordReport() {
  if (!window.docx) { alert("Librería Word no disponible. Recarga la página e inténtalo de nuevo."); return; }

  var btn = document.getElementById("btnDownloadWord");
  btn.textContent = "Generando…";
  btn.disabled = true;

  try {
    var D = window.docx;
    var GREEN   = "86BC25";
    var BLACK   = "000000";
    var DGRAY   = "53565A";
    var LGRAY   = "F2F2F2";
    var WHITE   = "FFFFFF";
    var MGRAY   = "D0D0CE";

    var s            = window._archiaState || {};
    var analysisType = s.analysisType;
    var filename     = s.filename || "documento";
    var results      = s.lastResults || [];
    var date         = new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
    var isFormulario = analysisType === "formulario";

    // ── helpers ──────────────────────────────────────────────────────────────
    function txt(text, opts) {
      return new D.TextRun(Object.assign({ text: text || "", font: "Arial", size: 20, color: DGRAY }, opts || {}));
    }
    function par(children, opts) {
      return new D.Paragraph(Object.assign({ children: Array.isArray(children) ? children : [children] }, opts || {}));
    }
    function spacer(lines) {
      lines = lines || 1;
      var arr = [];
      for (var i = 0; i < lines; i++) arr.push(par([txt("")]));
      return arr;
    }

    // ── inline markdown → TextRun[] ──────────────────────────────────────────
    function inlineRuns(raw, baseOpts) {
      var base = Object.assign({ font: "Arial", size: 20, color: DGRAY }, baseOpts || {});
      var runs = [];
      var regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+)/g;
      var m;
      raw = (raw || "").replace(/^[-*]\s+/, "");
      while ((m = regex.exec(raw)) !== null) {
        if (m[1]) runs.push(new D.TextRun(Object.assign({}, base, { text: m[1], bold: true })));
        else if (m[2]) runs.push(new D.TextRun(Object.assign({}, base, { text: m[2], italics: true })));
        else if (m[3]) runs.push(new D.TextRun(Object.assign({}, base, { text: m[3], font: "Courier New", size: 18 })));
        else if (m[4]) runs.push(new D.TextRun(Object.assign({}, base, { text: m[4] })));
      }
      return runs.length ? runs : [new D.TextRun(Object.assign({}, base, { text: raw }))];
    }

    // ── table builder ────────────────────────────────────────────────────────
    function buildTable(headers, rows) {
      var noBorder = { style: D.BorderStyle.NIL, size: 0, color: "auto" };
      var cellBorder = { style: D.BorderStyle.SINGLE, size: 4, color: MGRAY };

      function headerCell(text) {
        return new D.TableCell({
          children: [par([new D.TextRun({ text: text, font: "Arial", size: 18, bold: true, color: WHITE })],
            { spacing: { before: 80, after: 80 } })],
          shading: { fill: BLACK, type: D.ShadingType.CLEAR, color: "auto" },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          borders: { top: noBorder, bottom: noBorder, left: noBorder, right: { style: D.BorderStyle.SINGLE, size: 4, color: WHITE } }
        });
      }
      function dataCell(text, shade) {
        return new D.TableCell({
          children: [par(inlineRuns(text, { size: 18 }), { spacing: { before: 60, after: 60 } })],
          shading: shade ? { fill: LGRAY, type: D.ShadingType.CLEAR, color: "auto" } : undefined,
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
          borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder }
        });
      }

      var tableRows = [
        new D.TableRow({
          tableHeader: true,
          children: headers.map(headerCell)
        })
      ];
      rows.forEach(function(row, ri) {
        tableRows.push(new D.TableRow({
          children: row.map(function(cell) { return dataCell(cell, ri % 2 === 1); })
        }));
      });

      return new D.Table({
        width: { size: 100, type: D.WidthType.PERCENTAGE },
        rows: tableRows,
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      });
    }

    // ── markdown → docx elements ─────────────────────────────────────────────
    function mdToDocx(md) {
      var lines = (md || "").split("\n");
      var elements = [];
      var tableLines = [];

      function flushTable() {
        if (!tableLines.length) return;
        var headers = tableLines[0].split("|").slice(1,-1).map(function(c){ return c.trim(); });
        var dataRows = tableLines.slice(2).map(function(l) {
          return l.split("|").slice(1,-1).map(function(c){ return c.trim(); });
        }).filter(function(r){ return r.some(function(c){ return c; }); });
        elements.push(buildTable(headers, dataRows));
        elements = elements.concat(spacer(1));
        tableLines = [];
      }

      lines.forEach(function(line) {
        if (line.trim().startsWith("|")) { tableLines.push(line); return; }
        if (tableLines.length) flushTable();

        if (/^### /.test(line)) {
          elements.push(par([new D.TextRun({ text: line.slice(4), font: "Arial", size: 22, bold: true, color: BLACK })],
            { spacing: { before: 240, after: 80 } }));
          return;
        }
        if (/^## /.test(line)) {
          elements.push(par([new D.TextRun({ text: line.slice(3), font: "Arial", size: 26, bold: true, color: BLACK })],
            { spacing: { before: 320, after: 120 },
              border: { bottom: { color: GREEN, size: 8, style: D.BorderStyle.SINGLE, space: 4 } } }));
          return;
        }
        if (/^# /.test(line)) {
          elements.push(par([new D.TextRun({ text: line.slice(2), font: "Arial", size: 30, bold: true, color: BLACK })],
            { spacing: { before: 400, after: 160 } }));
          return;
        }
        if (/^---+$/.test(line.trim())) {
          elements.push(par([new D.TextRun({ text: "" })],
            { border: { bottom: { color: MGRAY, size: 4, style: D.BorderStyle.SINGLE } }, spacing: { before: 120, after: 120 } }));
          return;
        }
        if (/^[-*] /.test(line)) {
          elements.push(par(inlineRuns(line.slice(2)),
            { bullet: { level: 0 }, spacing: { before: 40, after: 40 } }));
          return;
        }
        if (/^\d+\. /.test(line)) {
          elements.push(par(inlineRuns(line.replace(/^\d+\. /, "")),
            { numbering: { reference: "default-numbering", level: 0 }, spacing: { before: 40, after: 40 } }));
          return;
        }
        if (line.trim() === "") { elements.push(par([txt("")])); return; }
        elements.push(par(inlineRuns(line), { spacing: { before: 40, after: 40 } }));
      });
      if (tableLines.length) flushTable();
      return elements;
    }

    // ── section heading (for main numbered sections) ─────────────────────────
    function sectionHeading(num, title) {
      return par([
        new D.TextRun({ text: num + ".  ", font: "Arial", size: 32, bold: true, color: GREEN }),
        new D.TextRun({ text: title, font: "Arial", size: 32, bold: true, color: BLACK })
      ], {
        spacing: { before: 560, after: 200 },
        border: { bottom: { color: GREEN, size: 12, style: D.BorderStyle.SINGLE, space: 6 } }
      });
    }

    // ── intro text ───────────────────────────────────────────────────────────
    function buildIntro() {
      var typeLabel = isFormulario ? "análisis de formulario de seguridad" : "análisis de arquitectura de seguridad";
      var modulesText = "";
      if (!isFormulario) {
        var modules = results.map(function(r){ return r.label; });
        modulesText = " Los módulos ejecutados han sido: " + modules.join(", ") + ".";
      }
      return [
        sectionHeading("1", "Introducción"),
        par([txt("El presente documento recoge los resultados del " + typeLabel + " realizado sobre el fichero ")],
          { spacing: { before: 80, after: 40 } }),
        par([txt(filename, { bold: true, color: BLACK }), txt(" con fecha " + date + "." + modulesText)],
          { spacing: { before: 0, after: 80 } }),
        par([txt(isFormulario
          ? "El análisis ha sido ejecutado de forma automatizada mediante la plataforma ArchIA de Deloitte, evaluando el contenido del cuestionario y generando la tabla de aplicabilidad de controles correspondiente."
          : "El análisis ha sido ejecutado de forma automatizada mediante la plataforma ArchIA de Deloitte, revisando el diseño y los marcos de control de seguridad aplicables a la arquitectura documentada. El informe presenta un resumen ejecutivo de hallazgos y el detalle técnico de cada módulo analizado.")],
          { spacing: { before: 80, after: 80 } })
      ];
    }

    // ── executive summary ────────────────────────────────────────────────────
    function buildExecutiveSummary() {
      var elems = [sectionHeading("2", "Resumen ejecutivo")];
      results.forEach(function(r) {
        if (!r.text) return;
        if (results.length > 1) {
          elems.push(par([new D.TextRun({ text: r.label, font: "Arial", size: 24, bold: true, color: BLACK })],
            { spacing: { before: 280, after: 100 } }));
        }
        // First ~8 non-empty lines as summary
        var summaryLines = r.text.split("\n").filter(function(l){ return l.trim() && !l.trim().startsWith("|") && !/^---/.test(l.trim()); }).slice(0, 8);
        summaryLines.forEach(function(l) {
          elems.push(par(inlineRuns(l), { spacing: { before: 40, after: 40 } }));
        });
      });
      return elems;
    }

    // ── detail section ───────────────────────────────────────────────────────
    function buildDetail() {
      var elems = [sectionHeading("3", "Detalle del análisis")];
      results.forEach(function(r) {
        if (!r.text) return;
        if (results.length > 1) {
          elems.push(par([new D.TextRun({ text: r.label, font: "Arial", size: 24, bold: true, color: BLACK })],
            { spacing: { before: 280, after: 100 } }));
        }
        elems = elems.concat(mdToDocx(r.text));
      });
      return elems;
    }

    // ── formulario: only applicability table ─────────────────────────────────
    function buildFormularioDoc() {
      var r = results[0];
      var elems = [sectionHeading("1", "Tabla de aplicabilidad")];
      if (r && r.text) elems = elems.concat(mdToDocx(r.text));
      return elems;
    }

    // ── header / footer ──────────────────────────────────────────────────────
    var docHeader = new D.Header({
      children: [
        new D.Paragraph({
          children: [
            new D.TextRun({ text: "Deloitte.", font: "Arial", size: 18, bold: true, color: BLACK }),
            new D.TextRun({ text: "  ArchIA — Security Architecture Review", font: "Arial", size: 16, color: DGRAY })
          ],
          border: { bottom: { color: GREEN, size: 8, style: D.BorderStyle.SINGLE, space: 4 } },
          spacing: { after: 80 }
        })
      ]
    });
    var docFooter = new D.Footer({
      children: [
        new D.Paragraph({
          children: [
            new D.TextRun({ text: "© 2025 Deloitte.  Uso interno  ·  ", font: "Arial", size: 16, color: MGRAY }),
            new D.TextRun({ children: [D.PageNumber.CURRENT], font: "Arial", size: 16, color: MGRAY })
          ],
          alignment: D.AlignmentType.RIGHT,
          border: { top: { color: MGRAY, size: 4, style: D.BorderStyle.SINGLE, space: 4 } },
          spacing: { before: 80 }
        })
      ]
    });

    // ── cover page ───────────────────────────────────────────────────────────
    var coverChildren = [
      par([txt("")], { spacing: { before: 0, after: 0 } }),
      par([txt("")], { spacing: { before: 0, after: 0 } }),
      par([txt("")], { spacing: { before: 0, after: 0 } }),
      par([txt("")], { spacing: { before: 0, after: 0 } }),
      par([txt("")], { spacing: { before: 0, after: 0 } }),
      par([txt("")], { spacing: { before: 0, after: 0 } }),
      par([new D.TextRun({ text: "Deloitte.", font: "Arial", size: 72, bold: true, color: BLACK })],
        { alignment: D.AlignmentType.LEFT, spacing: { before: 0, after: 160 } }),
      par([new D.TextRun({ text: "ArchIA", font: "Arial", size: 72, bold: true, color: GREEN })],
        { alignment: D.AlignmentType.LEFT, spacing: { before: 0, after: 80 } }),
      par([new D.TextRun({ text: "Security Architecture Review", font: "Arial", size: 32, bold: false, color: DGRAY })],
        { alignment: D.AlignmentType.LEFT, spacing: { before: 0, after: 400 } }),
      par([new D.TextRun({ text: (isFormulario ? "Análisis de formulario de seguridad" : "Análisis de arquitectura de seguridad"), font: "Arial", size: 26, bold: true, color: BLACK })],
        { alignment: D.AlignmentType.LEFT, spacing: { before: 0, after: 120 } }),
      par([new D.TextRun({ text: filename, font: "Arial", size: 22, color: DGRAY })],
        { alignment: D.AlignmentType.LEFT, spacing: { before: 0, after: 80 } }),
      par([new D.TextRun({ text: date, font: "Arial", size: 20, color: DGRAY })],
        { alignment: D.AlignmentType.LEFT, spacing: { before: 0, after: 0 } }),
      par([txt("")], { pageBreakBefore: true })
    ];

    // ── assemble body ─────────────────────────────────────────────────────────
    var bodyChildren;
    if (isFormulario) {
      bodyChildren = coverChildren.concat(buildFormularioDoc());
    } else {
      bodyChildren = coverChildren
        .concat(buildIntro())
        .concat(spacer(1))
        .concat(buildExecutiveSummary())
        .concat(spacer(1))
        .concat(buildDetail());
    }

    var doc = new D.Document({
      numbering: {
        config: [{
          reference: "default-numbering",
          levels: [{ level: 0, format: D.LevelFormat.DECIMAL, text: "%1.", alignment: D.AlignmentType.START,
            style: { paragraph: { indent: { left: 360, hanging: 360 } } } }]
        }]
      },
      sections: [{
        properties: {
          page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } }
        },
        headers: { default: docHeader },
        footers: { default: docFooter },
        children: bodyChildren
      }]
    });

    var blob = await D.Packer.toBlob(doc);
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "ArchIA_" + (isFormulario ? "Formulario" : "Arquitectura") + "_" + filename.replace(/\.[^.]+$/, "") + "_" + new Date().toISOString().slice(0,10) + ".docx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch(e) {
    alert("Error generando el informe: " + e.message);
    if (window.__logError) window.__logError("WORD ERROR", e.message, e.stack);
  } finally {
    btn.textContent = "Descargar informe Word";
    btn.disabled = false;
  }
}

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
  const state = { file: null, uploaded: false, polling: null, analysisType: null };

  function authHeaders() { return { "Authorization": "Bearer " + API_TOKEN }; }

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
      var allowed = [".doc", ".docx", ".pdf"];
      var ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
      if (!allowed.includes(ext)) {
        setUploadStatus(errorIcon("Formato no admitido: " + ext + ". Usa .doc, .docx o .pdf"));
        $("fileInfo").style.display = "none";
        dropZone.style.display = "";
        return;
      }
      state.file = f;
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
    var html = "";
    results.forEach(function(r, i) {
      if (results.length > 1) {
        html += '<div class="result-section-title"' + (i > 0 ? ' style="margin-top:28px"' : '') + '>' + labels[i] + '</div>';
      }
      if (r.status === "fulfilled") {
        html += r.value;
      } else {
        html += '<span style="color:var(--red)">Error: ' + escHtml(r.reason && r.reason.message || String(r.reason)) + '</span>';
      }
    });
    $("resultSpinner").style.display = "none";
    $("resultBox").style.display = "block";
    $("resultBox").className = "result-body";
    $("resultBox").innerHTML = html;
  }

  // ---- Invoke playbook → returns HTML string ----
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

  // ---- Poll task → returns HTML string ----
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
            resolve(text ? renderMarkdown(text) : '<pre style="white-space:pre-wrap;font-size:12px;color:var(--gray-700)">' + escHtml(JSON.stringify(data, null, 2)) + '</pre>');
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

  function renderMarkdown(md) {
    var lines = md.split("\n"), out = [], inTable = false, tableRows = [];
    function flushTable() {
      if (!tableRows.length) return;
      var header = tableRows[0], body = tableRows.slice(2);
      var html = "<table><thead><tr>" + header.map(function(c){ return "<th>" + inlineRender(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
      body.forEach(function(row){ html += "<tr>" + row.map(function(c){ return "<td>" + inlineRender(c) + "</td>"; }).join("") + "</tr>"; });
      html += "</tbody></table>"; out.push(html); tableRows = []; inTable = false;
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

})();

function toggleOpt(btn) {
  btn.classList.toggle("selected");
}

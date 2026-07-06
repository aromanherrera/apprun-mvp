// Auth guard
if (!sessionStorage.getItem('archiaAuth')) { window.location.href = 'login.html'; }
function doLogout() { sessionStorage.removeItem('archiaAuth'); window.location.href = 'login.html'; }

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
    var html = '<span class="err-time">' + esc(time) + '</span><span class="err-type">' + esc(type) + '</span><span class="err-msg">' + esc(msg) + '</span>';
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
  var API_BASE    = "https://api1-soarplus-pre.es.deloitte.com";
  var API_TOKEN   = "sk-UmL4haDNvWZdQ4a8ZxKb3Q";
  var POLL_INTERVAL = 5000;
  var STORAGE_KEY = "archiaProjects";

  var $ = function(id) { return document.getElementById(id); };
  var state = { file: null, filename: null, uploaded: false, polling: null, analysisType: null, lastResults: [], projectName: "" };
  window._archiaState = state;

  function authHeaders() { return { "Authorization": "Bearer " + API_TOKEN }; }

  // ================================================================
  // UPLOAD STATUS HELPERS
  // ================================================================
  function setUploadStatus(html) {
    var el = $("uploadStatus"); if (!el) return;
    el.style.display = "flex"; el.innerHTML = html;
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

  // ================================================================
  // API LOGGER
  // ================================================================
  function log(type, data) {
    var entries = $("logEntries"); if (!entries) return;
    var div = document.createElement("div");
    div.className = "log-entry " + type;
    var time = new Date().toLocaleTimeString("es-ES", { hour12:false, hour:"2-digit", minute:"2-digit", second:"2-digit" });
    var headHtml = "", bodyHtml = "";
    if (type === "log-req") {
      headHtml = '<span class="log-method">' + escHtml(data.method) + '</span><span class="log-url">' + escHtml(data.url) + '</span><span class="log-time">' + time + '</span>';
      var parts = [];
      if (data.headers) parts.push("Headers: " + JSON.stringify(data.headers, null, 2));
      if (data.body) parts.push("Body: " + data.body);
      bodyHtml = parts.join("\n\n");
    } else {
      var status = data.status ? " HTTP " + data.status : "";
      headHtml = '<span class="log-method">' + escHtml(data.label || "RESPONSE") + '</span><span class="log-url">' + escHtml(status) + ' ' + escHtml(data.url || "") + '</span><span class="log-time">' + (data.ms ? data.ms + "ms · " : "") + time + '</span>';
      bodyHtml = data.body || data.error || "";
    }
    div.innerHTML = '<div class="log-head">' + headHtml + '</div>' + (bodyHtml ? '<div class="log-body">' + escHtml(bodyHtml) + '</div>' : "");
    entries.appendChild(div);
    entries.scrollTop = entries.scrollHeight;
  }

  async function apiFetch(url, options) {
    options = options || {};
    var method = (options.method || "GET").toUpperCase();
    var headers = options.headers || {};
    var loggedBody = "";
    if (options.body instanceof FormData) {
      var parts = [];
      for (var pair of options.body.entries()) {
        parts.push(pair[0] + ": " + (pair[1] instanceof File ? "[File: " + pair[1].name + ", " + (pair[1].size/1024).toFixed(0) + " KB]" : String(pair[1])));
      }
      loggedBody = "FormData {\n  " + parts.join("\n  ") + "\n}";
    } else if (options.body) {
      loggedBody = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }
    log("log-req", { method: method, url: url, headers: headers, body: loggedBody });
    var t0 = Date.now();
    try {
      var res = await fetch(url, options);
      var ms = Date.now() - t0;
      var bodyText = await res.text();
      log(res.ok ? "log-res-ok" : "log-res-err", { label: res.ok ? "OK" : "ERROR", url: url, status: res.status, ms: ms, body: bodyText.slice(0, 2000) });
      return { ok: res.ok, status: res.status, text: bodyText };
    } catch (e) {
      var ms2 = Date.now() - t0;
      var hint = (e instanceof TypeError && e.message.includes("fetch")) ? "\n\nPosible causa: CORS. Usa Chrome con --disable-web-security." : "";
      log("log-net-err", { label: "NET ERROR [" + e.constructor.name + "]", url: url, ms: ms2, error: e.message + hint });
      if (window.__logError) window.__logError("NET ERROR", e.message + hint, e.stack);
      throw e;
    }
  }

  // ================================================================
  // LOCAL STORAGE — HISTORY
  // ================================================================
  function loadProjects() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch(_) { return []; }
  }
  function saveProjects(projects) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); } catch(_) {}
  }
  function saveRun(run) {
    var projects = loadProjects();
    var name = run.projectName || "Sin nombre";
    var proj = projects.find(function(p) { return p.name === name; });
    if (!proj) { proj = { name: name, runs: [] }; projects.unshift(proj); }
    proj.runs.unshift(run);
    // Keep max 5 runs per project
    if (proj.runs.length > 5) proj.runs = proj.runs.slice(0, 5);
    // Keep max 20 projects
    if (projects.length > 20) projects = projects.slice(0, 20);
    saveProjects(projects);
    renderSidebar();
  }

  // ================================================================
  // SIDEBAR RENDERING
  // ================================================================
  function renderSidebar() {
    var projects = loadProjects();
    var sidebar = $("sidebar");
    var sbList = $("sbList");
    sidebar.classList.remove("hidden");
    sbList.innerHTML = "";
    if (!projects.length) {
      sbList.innerHTML = '<div class="sb-empty">Aún no hay proyectos guardados.<br>Ejecuta tu primer análisis para verlo aquí.</div>';
      return;
    }
    projects.forEach(function(proj, pi) {
      var div = document.createElement("div");
      div.className = "sb-project";
      var nameDiv = document.createElement("div");
      nameDiv.className = "sb-project-name";
      nameDiv.innerHTML = '<span>' + escHtml(proj.name) + '</span><span class="sb-chevron">&#9656;</span>';
      nameDiv.onclick = function() { div.classList.toggle("open"); };
      div.appendChild(nameDiv);
      var runsDiv = document.createElement("div");
      runsDiv.className = "sb-runs";
      proj.runs.forEach(function(run, ri) {
        var r = document.createElement("div");
        r.className = "sb-run";
        r.dataset.projIdx = pi;
        r.dataset.runIdx = ri;
        var typeLabel = run.analysisType === "formulario" ? "Formulario" : "Arquitectura";
        var dateStr = run.date ? new Date(run.date).toLocaleDateString("es-ES", {day:"2-digit",month:"short",year:"numeric"}) : "";
        r.innerHTML = '<div class="sb-run-type">' + typeLabel + '</div>' +
          '<div class="sb-run-file">' + escHtml(run.filename || "") + '</div>' +
          '<div class="sb-run-date">' + dateStr + '</div>';
        r.onclick = function() {
          document.querySelectorAll(".sb-run").forEach(function(el){ el.classList.remove("active"); });
          r.classList.add("active");
          showHistoryRun(run);
        };
        runsDiv.appendChild(r);
      });
      div.appendChild(runsDiv);
      sbList.appendChild(div);
    });
  }

  function showHistoryRun(run) {
    $("wizardView").style.display = "none";
    $("historyView").style.display = "block";
    var dateStr = run.date ? new Date(run.date).toLocaleDateString("es-ES", {day:"2-digit",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "";
    var typeLabel = run.analysisType === "formulario" ? "Análisis de formulario" : "Análisis de arquitectura";
    var modules = (run.modules || []).join(", ") || "—";
    $("hvMeta").innerHTML =
      '<div class="hv-meta-item"><div class="hv-meta-label">Proyecto</div><div class="hv-meta-val">' + escHtml(run.projectName || "—") + '</div></div>' +
      '<div class="hv-meta-item"><div class="hv-meta-label">Tipo</div><div class="hv-meta-val">' + typeLabel + '</div></div>' +
      '<div class="hv-meta-item"><div class="hv-meta-label">Documento</div><div class="hv-meta-val">' + escHtml(run.filename || "—") + '</div></div>' +
      '<div class="hv-meta-item"><div class="hv-meta-label">Módulos</div><div class="hv-meta-val">' + escHtml(modules) + '</div></div>' +
      '<div class="hv-meta-item"><div class="hv-meta-label">Fecha</div><div class="hv-meta-val">' + dateStr + '</div></div>';
    // Render results
    var html = buildResultsHtml(run.results || [], false);
    $("hvContent").innerHTML = html;
    // Store for Word export
    window._archiaHistoryRun = run;
    $("historyView").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("btnHvBack").addEventListener("click", function() {
    $("historyView").style.display = "none";
    $("wizardView").style.display = "block";
    document.querySelectorAll(".sb-run").forEach(function(el){ el.classList.remove("active"); });
    window._archiaHistoryRun = null;
  });

  $("btnExportHistory").addEventListener("click", function() {
    var data = JSON.stringify(loadProjects(), null, 2);
    var blob = new Blob([data], {type:"application/json"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "archia-historial.json"; a.click();
    URL.revokeObjectURL(url);
  });

  $("btnClearHistory").addEventListener("click", function() {
    if (!confirm("¿Borrar todo el historial guardado?")) return;
    localStorage.removeItem(STORAGE_KEY);
    renderSidebar();
  });

  // ================================================================
  // TYPE SELECTION
  // ================================================================
  window.selectType = function(type) {
    ["typeArquitectura","typeFormulario"].forEach(function(id){ $(id).classList.remove("selected"); });
    $(type === "arquitectura" ? "typeArquitectura" : "typeFormulario").classList.add("selected");
    state.analysisType = type;
    resetSubSteps();
    $("stepUpload").style.display = "block";
    if (type === "arquitectura") {
      $("uploadDesc").textContent = "Adjunta el documento de arquitectura a analizar. Formatos: .doc, .docx, .pdf, .md";
      $("executeStepLabel").textContent = "Paso 4 — Ejecución";
    } else {
      $("uploadDesc").textContent = "Adjunta el cuestionario o formulario a analizar. Formatos: .doc, .docx, .pdf, .md";
      $("executeStepLabel").textContent = "Paso 3 — Ejecución";
    }
    $("stepUpload").scrollIntoView({ behavior:"smooth", block:"start" });
  };

  // ================================================================
  // FILE UPLOAD
  // ================================================================
  var dropZone = $("dropZone");
  var fileInput = $("fileInput");

  dropZone.addEventListener("click", function() { fileInput.click(); });
  ["dragenter","dragover"].forEach(function(ev) {
    dropZone.addEventListener(ev, function(e) { e.preventDefault(); dropZone.classList.add("over"); });
  });
  ["dragleave","drop"].forEach(function(ev) {
    dropZone.addEventListener(ev, function(e) { e.preventDefault(); dropZone.classList.remove("over"); });
  });
  dropZone.addEventListener("drop", function(e) { var f = e.dataTransfer.files[0]; if (f) setFile(f); });
  fileInput.addEventListener("change", function() { if (fileInput.files[0]) setFile(fileInput.files[0]); });
  $("btnRemove").addEventListener("click", resetSubSteps);

  function setFile(f) {
    try {
      var allowed = [".doc",".docx",".pdf",".md"];
      var ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
      if (!allowed.includes(ext)) {
        setUploadStatus(errorIcon("Formato no admitido: " + ext + ". Usa .doc, .docx, .pdf o .md"));
        $("fileInfo").style.display = "none"; dropZone.style.display = ""; return;
      }
      state.file = f; state.filename = f.name; state.uploaded = false;
      $("fileName").textContent = f.name + "  (" + (f.size/1024).toFixed(0) + " KB)";
      $("fileInfo").style.display = "flex"; dropZone.style.display = "none";
      $("btnPlaybook").disabled = true;
      uploadFile(f);
    } catch(e) { setUploadStatus(errorIcon("Error: " + e.message)); }
  }

  async function uploadFile(f) {
    setUploadStatus(spinner("Subiendo fichero…"));
    try {
      var fd = new FormData(); fd.append("file", f);
      var res = await apiFetch(API_BASE + "/datasource/uploadfile/", { method:"POST", headers:authHeaders(), body:fd });
      if (!res.ok) {
        // If upload failed, check if file already exists on the platform
        var listRes = await apiFetch(API_BASE + "/datasource/listfiles/", { headers:authHeaders() });
        var data = null; try { data = JSON.parse(listRes.text); } catch(_) {}
        if (listRes.ok && fileFoundInList(data, f.name)) {
          // File already uploaded — treat as success
          setUploadStatus(checkIcon("Fichero ya disponible en la plataforma: " + f.name));
          state.uploaded = true;
          if (state.analysisType === "arquitectura") {
            $("stepOpciones").style.display = "block";
            $("optArqPub").disabled = false; $("optArqNav").disabled = false;
          }
          $("stepEjecutar").style.display = "block"; $("btnPlaybook").disabled = false;
          return;
        }
        throw new Error("HTTP " + res.status);
      }
      setUploadStatus(spinner("Fichero enviado. Verificando disponibilidad…"));
      startPolling(f.name);
    } catch(e) { setUploadStatus(errorIcon("Error al subir: " + e.message)); }
  }

  function startPolling(filename) {
    clearInterval(state.polling);
    state.polling = setInterval(async function() {
      try {
        var res = await apiFetch(API_BASE + "/datasource/listfiles/", { headers:authHeaders() });
        if (!res.ok) return;
        var data = null; try { data = JSON.parse(res.text); } catch(_) {}
        if (fileFoundInList(data, filename)) {
          clearInterval(state.polling); state.uploaded = true;
          setUploadStatus(checkIcon("Fichero disponible: " + filename));
          if (state.analysisType === "arquitectura") {
            $("stepOpciones").style.display = "block";
            $("optArqPub").disabled = false; $("optArqNav").disabled = false;
          }
          $("stepEjecutar").style.display = "block"; $("btnPlaybook").disabled = false;
        }
      } catch(_) {}
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

  // ================================================================
  // PLAYBOOK EXECUTION
  // ================================================================
  $("btnPlaybook").addEventListener("click", async function() {
    if (!state.file || !state.uploaded) return;
    var pname = ($("projectName").value || "").trim();
    if (!pname) {
      var pf = $("projectName");
      pf.style.borderColor = "var(--red)";
      pf.focus();
      pf.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(function(){ pf.style.borderColor = ""; }, 2000);
      return;
    }
    state.projectName = pname;
    $("btnPlaybook").disabled = true;
    $("playbookStatus").textContent = "";
    $("resultCard").style.display = "block";
    $("resultBox").style.display = "none";
    $("resultSpinner").style.display = "flex";
    $("resultCard").scrollIntoView({ behavior:"smooth", block:"start" });

    if (state.analysisType === "formulario") await runFormulario();
    else await runArquitectura();

    $("btnPlaybook").disabled = false;
  });

  async function runFormulario() {
    var query = "poner en {cuestionario} el fichero con el nombre " + state.file.name;
    var results = await Promise.allSettled([invokePlaybook("sep-01scoping-secarch", query)]);
    var labels = ["Análisis de formulario"];
    finalizeResults(results, labels);
  }

  async function runArquitectura() {
    var query = "incluye en la variable {documentos} el fichero denominado " + state.file.name;
    var doArqPub = $("optArqPub").classList.contains("selected");
    var doArqNav = $("optArqNav").classList.contains("selected");
    var jobs = [invokePlaybook("analisis-de-diseno-inicial-de-arquitectura", query)];
    var labels = ["Marcos de controles"];
    if (doArqPub) { jobs.push(invokePlaybook("revarquitectura", query)); labels.push("Arquitectura de publicación"); }
    if (doArqNav) { jobs.push(invokePlaybook("revarquitectura", query)); labels.push("Arquitectura de navegación"); }
    var results = await Promise.allSettled(jobs);
    finalizeResults(results, labels);
  }

  function finalizeResults(results, labels) {
    state.lastResults = [];
    var stored = [];
    results.forEach(function(r, i) {
      if (r.status === "fulfilled") {
        state.lastResults.push({ label: labels[i], text: r.value.text });
        stored.push({ label: labels[i], text: r.value.text });
      } else {
        state.lastResults.push({ label: labels[i], text: null });
        stored.push({ label: labels[i], text: null });
      }
    });

    // Save to localStorage
    var modules = labels.slice();
    saveRun({
      id: Date.now(),
      date: new Date().toISOString(),
      projectName: state.projectName,
      analysisType: state.analysisType,
      filename: state.filename,
      modules: modules,
      results: stored
    });

    var html = buildResultsHtml(stored, true);
    $("resultSpinner").style.display = "none";
    $("resultBox").style.display = "block";
    $("resultBox").innerHTML = html;
    var hasData = stored.some(function(r){ return r.text; });
    $("btnDownloadWord").style.display = hasData ? "inline-block" : "none";
  }

  // ================================================================
  // RESULTS HTML BUILDER
  // ================================================================
  function stripSummarySection(text) {
    // Remove markdown sections whose heading contains summary-like keywords (Resumen, Estadísticas, Totales)
    // Also remove standalone bullet lines that are just "Label: number"
    var lines = (text || "").split("\n");
    var out = [];
    var inSummary = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var isHeading = /^#{1,3}\s+/.test(l);
      if (isHeading) {
        var headingText = l.replace(/^#+\s+/, "").toLowerCase();
        inSummary = /resumen|estadístic|totales|aplicabilidad|summary/.test(headingText);
        if (inSummary) continue;
      }
      if (inSummary) continue;
      out.push(l);
    }
    return out.join("\n");
  }

  function buildResultsHtml(stored, multiSection) {
    var allHtml = "";
    stored.forEach(function(r, i) {
      var bodyText = r.text ? stripSummarySection(r.text) : null;
      var sectionHtml = bodyText ? renderMarkdown(bodyText) : '<p style="color:var(--red)">Error al procesar este módulo.</p>';
      if (multiSection && stored.length > 1) {
        allHtml += '<div class="result-section-label">' + escHtml(r.label) + '</div>';
      }
      allHtml += '<div class="result-body">' + sectionHtml + '</div>';
      if (i < stored.length - 1) allHtml += '<hr style="border:none;border-top:1px solid var(--border);margin:24px 0">';
    });
    // Build stat cards from all text combined (uses original text with summary)
    var combinedText = stored.map(function(r){ return r.text || ""; }).join("\n");
    var statHtml = buildStatCards(combinedText);
    return statHtml + allHtml;
  }

  // ================================================================
  // STAT CARDS (big numbers extracted from text)
  // ================================================================
  function buildStatCards(text) {
    // Extract "Label: number" patterns from summary lines
    var stats = [];
    var re = /(?:[-*•]\s+)?\*{0,2}([^:\n*]{4,60}?)\*{0,2}:\s*\*{0,2}(\d+)\*{0,2}/g;
    var m;
    var seen = new Set();
    while ((m = re.exec(text)) !== null) {
      var label = m[1].trim().replace(/^["']|["']$/g,"");
      var val = parseInt(m[2]);
      // Skip if label looks like a sentence or is a duplicate
      if (label.split(" ").length > 8) continue;
      if (seen.has(label)) continue;
      seen.add(label);
      stats.push({ label: label, value: val });
    }
    if (!stats.length) return "";

    // Also count badges from rendered HTML
    var tmp = document.createElement("div");
    tmp.innerHTML = renderMarkdown(text);
    var si = tmp.querySelectorAll(".badge-si,.badge-aplicable").length;
    var no = tmp.querySelectorAll(".badge-no").length;
    var na = tmp.querySelectorAll(".badge-na").length;
    var parcial = tmp.querySelectorAll(".badge-parcial").length;
    var badgeTotal = si + no + na + parcial;

    // Prefer badge-derived counts if available, else use text-extracted stats
    var cards = [];
    if (badgeTotal > 0) {
      var total = badgeTotal;
      function pct(n) { return total > 0 ? Math.round(n/total*100)+"%" : ""; }
      cards.push({ cls:"sc-total", num: total, label:"Total\ncontroles" });
      if (si)      cards.push({ cls:"sc-si",      num:si,      label:"Aplicables",     pct:pct(si) });
      if (no)      cards.push({ cls:"sc-no",      num:no,      label:"No aplican",     pct:pct(no) });
      if (na)      cards.push({ cls:"sc-na",      num:na,      label:"N/A",            pct:pct(na) });
      if (parcial) cards.push({ cls:"sc-parcial", num:parcial, label:"Parcial",        pct:pct(parcial) });
    } else {
      // Use text-extracted stats (max 5)
      stats.slice(0, 5).forEach(function(s, i) {
        var cls = i === 0 ? "sc-total" : (i === 1 ? "sc-si" : (i === 2 ? "sc-na" : "sc-parcial"));
        cards.push({ cls: cls, num: s.value, label: s.label, pct: "" });
      });
    }

    var html = '<div class="stat-row">';
    cards.forEach(function(c) {
      html += '<div class="stat-card ' + c.cls + '">' +
        '<div class="stat-num">' + c.num + '</div>' +
        '<div class="stat-label">' + escHtml(c.label) + '</div>' +
        (c.pct ? '<div class="stat-pct">' + c.pct + ' del total</div>' : '') +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  // ================================================================
  // INVOKE PLAYBOOK → {html, text}
  // ================================================================
  async function invokePlaybook(playbookName, query) {
    var res = await apiFetch(API_BASE + "/playbooks/invoke/" + playbookName, {
      method: "POST",
      headers: Object.assign({}, authHeaders(), { "Content-Type": "application/json" }),
      body: JSON.stringify({ query: query })
    });
    if (!res.ok) throw new Error("HTTP " + res.status + " – " + res.text.slice(0, 200));
    var json;
    try { json = JSON.parse(res.text); } catch(_) { throw new Error("Respuesta no es JSON: " + res.text.slice(0, 200)); }
    var taskId = json.id || json.task_id || json.taskId || (json.status && json.status.id) || null;
    if (!taskId) throw new Error("No task ID: " + JSON.stringify(json).slice(0, 300));
    return pollTask(taskId);
  }

  function pollTask(taskId) {
    return new Promise(function(resolve, reject) {
      var url = API_BASE + "/agents/callagent-orchestrator/task/" + taskId;
      var attempts = 0; var maxAttempts = 120;
      function scheduleNext() {
        if (attempts >= maxAttempts) { reject(new Error("Tiempo de espera agotado")); return; }
        setTimeout(checkTask, 5000);
      }
      async function checkTask() {
        attempts++;
        try {
          var res = await apiFetch(url, { headers: authHeaders() });
          if (!res.ok) { scheduleNext(); return; }
          var data; try { data = JSON.parse(res.text); } catch(_) { scheduleNext(); return; }
          var statusObj = data.status || data;
          var taskState = (statusObj.state || statusObj.status || "").toLowerCase();
          if (taskState === "working" || taskState === "pending" || taskState === "running" || taskState === "") { scheduleNext(); return; }
          if (taskState === "completed" || taskState === "done" || taskState === "success") {
            var text = extractText(statusObj);
            var html = text ? renderMarkdown(text) : '<pre>' + escHtml(JSON.stringify(data, null, 2)) + '</pre>';
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

  // ================================================================
  // RESET
  // ================================================================
  $("btnReset").addEventListener("click", resetAll);

  function resetSubSteps() {
    clearInterval(state.polling);
    state.file = null; state.uploaded = false;
    fileInput.value = "";
    $("fileInfo").style.display = "none";
    $("uploadStatus").style.display = "none"; $("uploadStatus").innerHTML = "";
    dropZone.style.display = "";
    $("btnPlaybook").disabled = true; $("playbookStatus").textContent = "";
    $("stepOpciones").style.display = "none"; $("stepEjecutar").style.display = "none";
    $("resultCard").style.display = "none"; $("resultSpinner").style.display = "none";
    $("resultBox").style.display = "none"; $("resultBox").innerHTML = "";
    var btnW = $("btnDownloadWord"); if (btnW) btnW.style.display = "none";
    ["optArqPub","optArqNav"].forEach(function(id) {
      var el = $(id); if (el) { el.disabled = true; el.classList.remove("selected"); }
    });
  }

  function resetAll() {
    resetSubSteps();
    state.analysisType = null;
    ["typeArquitectura","typeFormulario"].forEach(function(id){ $(id).classList.remove("selected"); });
    $("stepUpload").style.display = "none";
  }

  // ================================================================
  // HELPERS
  // ================================================================
  function extractText(statusObj) {
    var msg = statusObj.message; if (!msg) return null;
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
      .replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")
      .replace(/\*(.+?)\*/g,"<em>$1</em>")
      .replace(/`(.+?)`/g,"<code>$1</code>");
  }

  function statusBadge(raw) {
    var v = raw.trim(), lo = v.toLowerCase();
    if (lo==="sí"||lo==="si"||lo==="yes"||lo==="✓")      return '<span class="badge badge-si">'+ escHtml(v)+'</span>';
    if (lo==="no")                                          return '<span class="badge badge-no">'+escHtml(v)+'</span>';
    if (lo==="n/a"||lo==="na"||lo==="no aplica"||lo==="no aplicable") return '<span class="badge badge-na">'+escHtml(v)+'</span>';
    if (lo==="parcial"||lo==="parcialmente")                return '<span class="badge badge-parcial">'+escHtml(v)+'</span>';
    if (lo==="aplicable")                                   return '<span class="badge badge-aplicable">'+escHtml(v)+'</span>';
    if (lo==="alto"||lo==="crítico")                        return '<span class="badge badge-alto">'+escHtml(v)+'</span>';
    if (lo==="medio"||lo==="moderado")                      return '<span class="badge badge-medio">'+escHtml(v)+'</span>';
    if (lo==="bajo")                                        return '<span class="badge badge-bajo">'+escHtml(v)+'</span>';
    return inlineRender(v);
  }

  function renderMarkdown(md) {
    var lines = (md||"").split("\n"), out = [], inTable = false, tableRows = [];
    function flushTable() {
      if (!tableRows.length) return;
      var header = tableRows[0], body = tableRows.slice(2);
      var html = '<div class="tbl-wrap"><table><thead><tr>';
      html += header.map(function(c){ return "<th>"+inlineRender(c)+"</th>"; }).join("");
      html += "</tr></thead><tbody>";
      body.forEach(function(row){
        html += "<tr>" + row.map(function(c, ci){
          return "<td>" + (ci > 0 ? statusBadge(c) : inlineRender(c)) + "</td>";
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
      if (/^### /.test(line)) { out.push("<h3>"+inlineRender(line.slice(4))+"</h3>"); return; }
      if (/^## /.test(line))  { out.push("<h2>"+inlineRender(line.slice(3))+"</h2>"); return; }
      if (/^# /.test(line))   { out.push("<h1>"+inlineRender(line.slice(2))+"</h1>"); return; }
      if (/^---+$/.test(line.trim())) { out.push("<hr>"); return; }
      if (/^[-*] /.test(line)) { out.push("<ul><li>"+inlineRender(line.slice(2))+"</li></ul>"); return; }
      if (/^\d+\. /.test(line)) { out.push("<ol><li>"+inlineRender(line.replace(/^\d+\. /,""))+"</li></ol>"); return; }
      if (line.trim()==="") { out.push("<br>"); return; }
      out.push("<p>"+inlineRender(line)+"</p>");
    });
    if (inTable) flushTable();
    return out.join("\n").replace(/<\/ul>\n<ul>/g,"").replace(/<\/ol>\n<ol>/g,"");
  }

  // ================================================================
  // INIT
  // ================================================================
  renderSidebar();

})();

// ================================================================
// GLOBAL FUNCTIONS (called from HTML onclick)
// ================================================================
function toggleOpt(btn) { btn.classList.toggle("selected"); }

function downloadWordReport() {
  _generateWord(window._archiaState);
}

function downloadWordFromHistory() {
  var run = window._archiaHistoryRun;
  if (!run) return;
  _generateWord({
    analysisType: run.analysisType,
    filename: run.filename,
    projectName: run.projectName,
    lastResults: run.results || []
  });
}

async function _generateWord(src) {
  if (!window.docx) { alert("Librería Word no disponible. Recarga la página."); return; }
  var btn = document.getElementById("btnDownloadWord") || document.getElementById("btnHvDownload");
  if (btn) { btn.textContent = "Generando…"; btn.disabled = true; }

  try {
    var D = window.docx;
    var GREEN="86BC25", BLACK="000000", DGRAY="53565A", LGRAY="F2F2F2", WHITE="FFFFFF", MGRAY="D0D0CE";

    var analysisType = src.analysisType;
    var filename     = src.filename || "documento";
    var projectName  = src.projectName || "";
    var results      = src.lastResults || [];
    var isFormulario = analysisType === "formulario";
    var date         = new Date().toLocaleDateString("es-ES", {day:"numeric",month:"long",year:"numeric"});

    function txt(text, opts) {
      return new D.TextRun(Object.assign({text:text||"",font:"Arial",size:20,color:DGRAY}, opts||{}));
    }
    function par(children, opts) {
      return new D.Paragraph(Object.assign({children:Array.isArray(children)?children:[children]}, opts||{}));
    }
    function spacer() { return par([txt("")]); }

    function inlineRuns(raw, base) {
      base = Object.assign({font:"Arial",size:20,color:DGRAY}, base||{});
      var runs=[], m;
      var regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+)/g;
      raw = (raw||"");
      while ((m=regex.exec(raw))!==null) {
        if (m[1]) runs.push(new D.TextRun(Object.assign({},base,{text:m[1],bold:true})));
        else if (m[2]) runs.push(new D.TextRun(Object.assign({},base,{text:m[2],italics:true})));
        else if (m[3]) runs.push(new D.TextRun(Object.assign({},base,{text:m[3],font:"Courier New",size:18})));
        else if (m[4]) runs.push(new D.TextRun(Object.assign({},base,{text:m[4]})));
      }
      return runs.length ? runs : [new D.TextRun(Object.assign({},base,{text:raw}))];
    }

    function buildTable(headers, rows) {
      var nob={style:D.BorderStyle.NIL,size:0,color:"auto"};
      var cb={style:D.BorderStyle.SINGLE,size:4,color:MGRAY};
      function hCell(t) {
        return new D.TableCell({
          children:[par([new D.TextRun({text:t,font:"Arial",size:18,bold:true,color:WHITE})],{spacing:{before:80,after:80}})],
          shading:{fill:BLACK,type:D.ShadingType.CLEAR,color:"auto"},
          margins:{top:80,bottom:80,left:100,right:100},
          borders:{top:nob,bottom:nob,left:nob,right:{style:D.BorderStyle.SINGLE,size:4,color:WHITE}}
        });
      }
      function dCell(t,shade) {
        return new D.TableCell({
          children:[par(inlineRuns(t,{size:18}),{spacing:{before:60,after:60}})],
          shading:shade?{fill:LGRAY,type:D.ShadingType.CLEAR,color:"auto"}:undefined,
          margins:{top:60,bottom:60,left:100,right:100},
          borders:{top:cb,bottom:cb,left:cb,right:cb}
        });
      }
      var trows=[new D.TableRow({tableHeader:true,children:headers.map(hCell)})];
      rows.forEach(function(row,ri){
        trows.push(new D.TableRow({children:row.map(function(c){return dCell(c,ri%2===1);})}));
      });
      return new D.Table({width:{size:100,type:D.WidthType.PERCENTAGE},rows:trows});
    }

    // Stat cards in Word: a grid-like table
    function buildStatTable(statsArr) {
      if (!statsArr.length) return null;
      var cells = statsArr.map(function(s) {
        return new D.TableCell({
          children:[
            par([new D.TextRun({text:String(s.value),font:"Arial",size:72,bold:true,color:BLACK})],{alignment:D.AlignmentType.CENTER,spacing:{before:120,after:60}}),
            par([new D.TextRun({text:s.label.toUpperCase(),font:"Arial",size:16,bold:true,color:DGRAY})],{alignment:D.AlignmentType.CENTER,spacing:{before:0,after:120}})
          ],
          borders:{top:{style:D.BorderStyle.SINGLE,size:6,color:GREEN},bottom:{style:D.BorderStyle.NIL,size:0,color:"auto"},left:{style:D.BorderStyle.SINGLE,size:4,color:MGRAY},right:{style:D.BorderStyle.SINGLE,size:4,color:MGRAY}},
          margins:{top:120,bottom:120,left:120,right:120}
        });
      });
      return new D.Table({
        width:{size:100,type:D.WidthType.PERCENTAGE},
        rows:[new D.TableRow({children:cells})]
      });
    }

    function mdToDocx(md) {
      var lines=(md||"").split("\n"), elements=[], tableLines=[];
      function flushTable() {
        if (!tableLines.length) return;
        var headers=tableLines[0].split("|").slice(1,-1).map(function(c){return c.trim();});
        var dataRows=tableLines.slice(2).map(function(l){return l.split("|").slice(1,-1).map(function(c){return c.trim();});}).filter(function(r){return r.some(function(c){return c;});});
        elements.push(buildTable(headers,dataRows));
        elements.push(spacer());
        tableLines=[];
      }
      lines.forEach(function(line) {
        if (line.trim().startsWith("|")) { tableLines.push(line); return; }
        if (tableLines.length) flushTable();
        if (/^### /.test(line)) {
          elements.push(par([new D.TextRun({text:line.slice(4),font:"Arial",size:22,bold:true,color:BLACK})],{spacing:{before:240,after:80}})); return;
        }
        if (/^## /.test(line)) {
          elements.push(par([new D.TextRun({text:line.slice(3),font:"Arial",size:26,bold:true,color:BLACK})],
            {spacing:{before:320,after:120},border:{bottom:{color:GREEN,size:8,style:D.BorderStyle.SINGLE,space:4}}})); return;
        }
        if (/^# /.test(line)) {
          elements.push(par([new D.TextRun({text:line.slice(2),font:"Arial",size:30,bold:true,color:BLACK})],{spacing:{before:400,after:160}})); return;
        }
        if (/^---+$/.test(line.trim())) {
          elements.push(par([txt("")],{border:{bottom:{color:MGRAY,size:4,style:D.BorderStyle.SINGLE}},spacing:{before:100,after:100}})); return;
        }
        if (/^[-*] /.test(line)) {
          elements.push(par(inlineRuns(line.slice(2)),{bullet:{level:0},spacing:{before:40,after:40}})); return;
        }
        if (/^\d+\. /.test(line)) {
          elements.push(par(inlineRuns(line.replace(/^\d+\. /,"")),{numbering:{reference:"default-numbering",level:0},spacing:{before:40,after:40}})); return;
        }
        if (line.trim()==="") { elements.push(spacer()); return; }
        elements.push(par(inlineRuns(line),{spacing:{before:40,after:40}}));
      });
      if (tableLines.length) flushTable();
      return elements;
    }

    function secHeading(num, title) {
      return par([
        new D.TextRun({text:num+".  ",font:"Arial",size:32,bold:true,color:GREEN}),
        new D.TextRun({text:title,font:"Arial",size:32,bold:true,color:BLACK})
      ],{spacing:{before:560,after:200},border:{bottom:{color:GREEN,size:12,style:D.BorderStyle.SINGLE,space:6}}});
    }

    // Extract stats from combined text for Word
    function extractStats(text) {
      var stats=[]; var re=/(?:[-*•]\s+)?\*{0,2}([^:\n*]{4,60}?)\*{0,2}:\s*\*{0,2}(\d+)\*{0,2}/g;
      var m, seen=new Set();
      while((m=re.exec(text))!==null){
        var label=m[1].trim(); var val=parseInt(m[2]);
        if(label.split(" ").length>8||seen.has(label)) continue;
        seen.add(label); stats.push({label:label,value:val});
      }
      return stats.slice(0,5);
    }

    var combinedText = results.map(function(r){return r.text||"";}).join("\n");
    var stats = extractStats(combinedText);

    function buildIntro() {
      var typeLabel = isFormulario ? "análisis de formulario de seguridad" : "análisis de arquitectura de seguridad";
      return [
        secHeading("1","Introducción"),
        par(inlineRuns("El presente documento recoge los resultados del " + typeLabel + " realizado sobre el fichero **" + filename + "** con fecha " + date + (projectName ? ", en el contexto del proyecto **" + projectName + "**." : ".")),{spacing:{before:80,after:80}}),
        par([txt(isFormulario
          ? "El análisis ha sido ejecutado de forma automatizada mediante la plataforma ArchIA de Deloitte, evaluando el contenido del cuestionario y generando la tabla de aplicabilidad de controles."
          : "El análisis ha sido ejecutado de forma automatizada mediante la plataforma ArchIA de Deloitte, revisando el diseño y marcos de control de seguridad aplicables. El informe presenta un resumen ejecutivo con métricas clave y el detalle técnico de cada módulo analizado.")],
          {spacing:{before:60,after:60}})
      ];
    }

    function buildExecSummary() {
      var elems=[secHeading("2","Resumen ejecutivo")];
      // Stat cards big-number table (replaces bullet summary)
      if (stats.length) {
        elems.push(spacer());
        var st=buildStatTable(stats);
        if(st) { elems.push(st); elems.push(spacer()); }
      }
      // First non-summary lines per module
      results.forEach(function(r) {
        if(!r.text) return;
        if(results.length>1) elems.push(par([new D.TextRun({text:r.label,font:"Arial",size:24,bold:true,color:BLACK})],{spacing:{before:240,after:80}}));
        // Skip lines inside summary/resumen sections and bare "label: number" bullet lines
        var inSum=false;
        var summaryLines=[];
        r.text.split("\n").forEach(function(l){
          var hm=/^#{1,3}\s+(.+)/.exec(l);
          if(hm){ inSum=/resumen|estadístic|totales|aplicabilidad|summary/i.test(hm[1]); }
          if(inSum) return;
          if(/^[-*•]\s+.{4,60}:\s*\d+/.test(l.trim())) return; // bare stat bullet
          if(l.trim()&&!l.trim().startsWith("|")&&!/^---/.test(l.trim())) summaryLines.push(l);
        });
        summaryLines.slice(0,6).forEach(function(l){ elems.push(par(inlineRuns(l),{spacing:{before:40,after:40}})); });
      });
      return elems;
    }

    function stripSummarySectionWord(text) {
      var lines=(text||"").split("\n"), out=[], inSum=false;
      lines.forEach(function(l){
        var hm=/^#{1,3}\s+(.+)/.exec(l);
        if(hm){ inSum=/resumen|estadístic|totales|aplicabilidad|summary/i.test(hm[1]); if(inSum) return; }
        if(inSum) return;
        out.push(l);
      });
      return out.join("\n");
    }

    function buildDetail() {
      var elems=[secHeading("3","Detalle del análisis")];
      results.forEach(function(r) {
        if(!r.text) return;
        if(results.length>1) elems.push(par([new D.TextRun({text:r.label,font:"Arial",size:24,bold:true,color:BLACK})],{spacing:{before:240,after:80}}));
        elems=elems.concat(mdToDocx(stripSummarySectionWord(r.text)));
      });
      return elems;
    }

    function buildFormularioDoc() {
      var r=results[0];
      var elems=[secHeading("1","Tabla de aplicabilidad")];
      if(r&&r.text) elems=elems.concat(mdToDocx(r.text));
      return elems;
    }

    var docHeader = new D.Header({children:[
      par([new D.TextRun({text:"Deloitte.",font:"Arial",size:18,bold:true,color:BLACK}),
           new D.TextRun({text:"  ArchIA — Security Architecture Review"+(projectName?" — "+projectName:""),font:"Arial",size:16,color:DGRAY})],
        {border:{bottom:{color:GREEN,size:8,style:D.BorderStyle.SINGLE,space:4}},spacing:{after:80}})
    ]});
    var docFooter = new D.Footer({children:[
      par([new D.TextRun({text:"© 2025 Deloitte.  Uso interno  ·  ",font:"Arial",size:16,color:MGRAY}),
           new D.TextRun({children:[D.PageNumber.CURRENT],font:"Arial",size:16,color:MGRAY})],
        {alignment:D.AlignmentType.RIGHT,border:{top:{color:MGRAY,size:4,style:D.BorderStyle.SINGLE,space:4}},spacing:{before:80}})
    ]});

    // Cover
    function coverPar(children, opts) { return par(children, Object.assign({alignment:D.AlignmentType.LEFT}, opts||{})); }
    var cover=[
      coverPar([txt("")]),coverPar([txt("")]),coverPar([txt("")]),coverPar([txt("")]),coverPar([txt("")]),
      coverPar([new D.TextRun({text:"Deloitte.",font:"Arial",size:72,bold:true,color:BLACK})],{spacing:{before:0,after:200}}),
      coverPar([new D.TextRun({text:"ArchIA",font:"Arial",size:72,bold:true,color:GREEN})],{spacing:{before:0,after:100}}),
      coverPar([new D.TextRun({text:"Security Architecture Review",font:"Arial",size:32,color:DGRAY})],{spacing:{before:0,after:500}}),
      coverPar([new D.TextRun({text:isFormulario?"Análisis de formulario":"Análisis de arquitectura de seguridad",font:"Arial",size:26,bold:true,color:BLACK})],{spacing:{before:0,after:100}}),
      ...(projectName?[coverPar([new D.TextRun({text:projectName,font:"Arial",size:22,bold:true,color:GREEN})],{spacing:{before:0,after:80}})]:[]),
      coverPar([new D.TextRun({text:filename,font:"Arial",size:20,color:DGRAY})],{spacing:{before:0,after:60}}),
      coverPar([new D.TextRun({text:date,font:"Arial",size:20,color:DGRAY})]),
      par([txt("")],{pageBreakBefore:true})
    ];

    var body = cover.concat(isFormulario
      ? buildFormularioDoc()
      : buildIntro().concat([spacer()]).concat(buildExecSummary()).concat([spacer()]).concat(buildDetail()));

    var doc = new D.Document({
      numbering:{config:[{reference:"default-numbering",levels:[{level:0,format:D.LevelFormat.DECIMAL,text:"%1.",alignment:D.AlignmentType.START,style:{paragraph:{indent:{left:360,hanging:360}}}}]}]},
      sections:[{
        properties:{page:{margin:{top:1080,right:1080,bottom:1080,left:1080}}},
        headers:{default:docHeader},footers:{default:docFooter},
        children:body
      }]
    });

    var blob = await D.Packer.toBlob(doc);
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href=url;
    a.download="ArchIA_"+(isFormulario?"Formulario":"Arquitectura")+"_"+filename.replace(/\.[^.]+$/,"")+"_"+new Date().toISOString().slice(0,10)+".docx";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch(e) {
    alert("Error generando el informe: " + e.message);
    if (window.__logError) window.__logError("WORD ERROR", e.message, e.stack);
  } finally {
    if (btn) { btn.textContent = "Descargar informe Word"; btn.disabled = false; }
  }
}

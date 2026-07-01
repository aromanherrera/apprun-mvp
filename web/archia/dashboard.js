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
    var stack = reason instanceof Error ? reason.stack : undefined;
    addError('PROMISE', msg, stack);
  });
  window.__logError = addError;
})();

(function () {
  const API_BASE = "https://api1-soarplus-pre.es.deloitte.com";
  const API_TOKEN = "sk-UmL4haDNvWZdQ4a8ZxKb3Q";
  const POLL_INTERVAL = 4000;

  const $ = id => document.getElementById(id);
  const state = { file: null, uploaded: false, polling: null };

  function authHeaders() {
    return { "Authorization": "Bearer " + API_TOKEN };
  }

  // ---- API Logger ----
  function log(type, data) {
    const entries = $("logEntries");
    if (!entries) return;
    const div = document.createElement("div");
    div.className = "log-entry " + type;
    const time = new Date().toLocaleTimeString("es-ES", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    let headHtml = "";
    let bodyHtml = "";
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
        parts.push(k + ": " + (v instanceof File ? "[File: " + v.name + ", " + (v.size/1024).toFixed(0) + " KB, " + v.type + "]" : String(v)));
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
        hint = "\n\nPosibles causas:\n" +
          "1. CORS: el servidor no permite peticiones desde este origen (" + location.origin + ")\n" +
          "2. Certificado SSL no confiable (abre " + url.split('/').slice(0,3).join('/') + " en el navegador y acepta el cert)\n" +
          "3. API no accesible desde esta red\n" +
          "4. Preflight OPTIONS bloqueado (requiere cabecera Access-Control-Allow-Origin)";
      }
      log("log-net-err", { label: "NET ERROR [" + e.constructor.name + "]", url, ms, error: e.message + hint });
      if (window.__logError) window.__logError("NET ERROR", e.message + hint, e.stack);
      throw e;
    }
  }

  // ---- UI helpers ----
  function setUploadStatus(html) {
    const el = $("uploadStatus");
    el.style.display = "flex";
    el.innerHTML = html;
  }
  function spinner(text) {
    return '<div class="spinner"></div><span class="status-text">' + text + '</span>';
  }
  function checkIcon(text) {
    return '<div class="check">&#10003;</div><span class="status-text ok">' + text + '</span>';
  }
  function errorIcon(text) {
    return '<div class="x-icon">&#10007;</div><span class="status-text err">' + text + '</span>';
  }

  // ---- Test connection ----
  document.getElementById("btnTestConn").addEventListener("click", async function() {
    var el = document.getElementById("connResult");
    el.style.color = "#6b9e6b";
    el.textContent = "Probando…";
    try {
      var r = await apiFetch(API_BASE + "/datasource/listfiles/", { headers: authHeaders() });
      el.style.color = "#4ade80";
      el.textContent = "✓ API accesible (HTTP " + r.status + ")";
    } catch(e) {
      el.style.color = "#f87171";
      el.textContent = "✗ No se puede conectar — abre http://localhost:8080 (no el fichero directamente)";
    }
  });

  // ---- File selection ----
  const dropZone = $("dropZone");
  const fileInput = $("fileInput");

  dropZone.addEventListener("click", () => fileInput.click());
  ["dragenter", "dragover"].forEach(function(ev) {
    dropZone.addEventListener(ev, function(e) { e.preventDefault(); dropZone.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function(ev) {
    dropZone.addEventListener(ev, function(e) { e.preventDefault(); dropZone.classList.remove("over"); });
  });
  dropZone.addEventListener("drop", function(e) {
    var f = e.dataTransfer.files[0];
    if (f) setFile(f);
  });
  fileInput.addEventListener("change", function() {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
  });

  $("btnRemove").addEventListener("click", resetAll);

  function setFile(f) {
    try {
      if (window.__logError) window.__logError('INFO', 'Fichero seleccionado: ' + f.name + ' (' + f.size + ' bytes, type=' + (f.type||'unknown') + ')');
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
      if (!res.ok) {
        throw new Error("HTTP " + res.status + (res.text ? " – " + res.text.slice(0, 120) : ""));
      }
      setUploadStatus(spinner("Fichero enviado. Verificando disponibilidad…"));
      startPolling(f.name);
    } catch (e) {
      setUploadStatus(errorIcon("Error al subir: " + e.message));
    }
  }

  // ---- Poll until file appears in listfiles ----
  function startPolling(filename) {
    clearInterval(state.polling);
    state.polling = setInterval(async function() {
      try {
        var res = await apiFetch(API_BASE + "/datasource/listfiles/", {
          headers: authHeaders()
        });
        if (!res.ok) return;
        var data = null;
        try { data = JSON.parse(res.text); } catch (_) {}
        if (fileFoundInList(data, filename)) {
          clearInterval(state.polling);
          state.uploaded = true;
          setUploadStatus(checkIcon("Fichero disponible en la plataforma: " + filename));
          $("btnPlaybook").disabled = false;
          $("optMarcos").disabled = false;
          $("optArqPub").disabled = false;
        }
      } catch (_) { /* seguir intentando */ }
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

  // ---- Playbook ----
  $("btnPlaybook").addEventListener("click", async function() {
    if (!state.file || !state.uploaded) return;
    $("btnPlaybook").disabled = true;
    $("playbookStatus").textContent = "";
    $("resultCard").style.display = "block";
    $("resultBox").innerHTML = '<div class="result-running"><div class="spinner"></div> Lanzando playbook…</div>';

    try {
      var marcos = $("optMarcos").classList.contains("selected") ? "Si" : "No";
      var arq    = ($("optArqPub").classList.contains("selected") || $("optArqNav").classList.contains("selected")) ? "Si" : "No";
      var msg = "incluye en la variable {documentos} el fichero denominado " + state.file.name +
                ". En la variable {marcos} incluye " + marcos +
                ". En la variable {arquitectura} incluye " + arq + ".";
      var res = await apiFetch(
        API_BASE + "/playbooks/invoke/analisis-de-diseno-inicial-de-arquitectura",
        {
          method: "POST",
          headers: Object.assign({}, authHeaders(), { "Content-Type": "application/json" }),
          body: JSON.stringify({ query: msg })
        }
      );
      if (!res.ok) throw new Error("HTTP " + res.status + " – " + res.text.slice(0, 200));

      var json;
      try { json = JSON.parse(res.text); } catch(_) { throw new Error("Respuesta no es JSON: " + res.text.slice(0, 200)); }

      // Extraer el task ID de la respuesta
      var taskId = json.id || json.task_id || json.taskId || (json.status && json.status.id) || null;
      if (!taskId) throw new Error("No se encontró ID de tarea en la respuesta: " + JSON.stringify(json).slice(0, 300));

      $("resultBox").innerHTML = '<div class="result-running"><div class="spinner"></div> Análisis en curso… (tarea ' + escHtml(taskId) + ')</div>';
      await pollTaskResult(taskId);

    } catch (e) {
      $("resultBox").innerHTML = '<span style="color:#f87171">Error: ' + escHtml(e.message) + '</span>';
      $("btnPlaybook").disabled = false;
    }
  });

  // ---- Poll task until completed ----
  async function pollTaskResult(taskId) {
    var url = API_BASE + "/agents/callagent-orchestrator/task/" + taskId;
    var attempts = 0;
    var maxAttempts = 120; // 10 min máximo a 5s por intento

    function scheduleNext() {
      if (attempts >= maxAttempts) {
        $("resultBox").innerHTML = '<span style="color:#f87171">Tiempo de espera agotado. El análisis sigue en curso en la plataforma (ID: ' + escHtml(taskId) + ')</span>';
        $("btnPlaybook").disabled = false;
        return;
      }
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
          $("resultBox").innerHTML = '<div class="result-running"><div class="spinner"></div> Analizando… (' + attempts * 5 + 's)</div>';
          scheduleNext();
          return;
        }

        if (taskState === "completed" || taskState === "done" || taskState === "success") {
          // Extraer texto de status.message.parts[].text
          var text = extractText(statusObj);
          $("resultBox").innerHTML = text ? renderMarkdown(text) : '<pre style="white-space:pre-wrap;font-size:12px;color:#6b9e6b">' + escHtml(JSON.stringify(data, null, 2)) + '</pre>';
          $("btnPlaybook").disabled = false;
          return;
        }

        // Estado de error u otro
        if (taskState === "failed" || taskState === "error") {
          var errText = extractText(statusObj) || JSON.stringify(data, null, 2);
          $("resultBox").innerHTML = '<span style="color:#f87171">El análisis terminó con error:<br><pre style="white-space:pre-wrap">' + escHtml(errText) + '</pre></span>';
          $("btnPlaybook").disabled = false;
          return;
        }

        // Estado desconocido — seguir esperando
        scheduleNext();

      } catch(e) {
        // Error de red — reintentar
        scheduleNext();
      }
    }

    checkTask();
  }

  function extractText(statusObj) {
    // status.message.parts[].text donde kind === "text"
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

  // ---- Copy ----
  $("btnCopy").addEventListener("click", function() {
    var text = $("resultBox").textContent;
    navigator.clipboard.writeText(text).then(function() {
      $("btnCopy").textContent = "✓ Copiado";
      setTimeout(function() { $("btnCopy").innerHTML = "&#128203; Copiar"; }, 2000);
    }).catch(function() {});
  });

  // ---- Reset ----
  $("btnReset").addEventListener("click", resetAll);

  function resetAll() {
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
    $("resultCard").style.display = "none";
    $("resultBox").textContent = "";
    ["optMarcos","optArqPub"].forEach(function(id) {
      var el = $(id); el.disabled = true; el.classList.remove("selected");
    });
  }

  function toggleOpt(btn) {
    btn.classList.toggle("selected");
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
    var lines = md.split("\n");
    var out = [];
    var inTable = false;
    var tableRows = [];
    function flushTable() {
      if (!tableRows.length) return;
      var header = tableRows[0];
      var body = tableRows.slice(2);
      var html = "<table><thead><tr>" +
        header.map(function(c){ return "<th>" + inlineRender(c) + "</th>"; }).join("") +
        "</tr></thead><tbody>";
      body.forEach(function(row) {
        html += "<tr>" + row.map(function(c){ return "<td>" + inlineRender(c) + "</td>"; }).join("") + "</tr>";
      });
      html += "</tbody></table>";
      out.push(html);
      tableRows = [];
      inTable = false;
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

(function () {
  const API_BASE = "https://api1-soarplus-pre.es.deloitte.com";
  const API_TOKEN = "sk-UmL4haDNvWZdQ4a8ZxKb3Q";
  const POLL_INTERVAL = 4000;

  const $ = id => document.getElementById(id);
  const state = { file: null, uploaded: false, polling: null };

  function authHeaders() {
    return { "Authorization": "Bearer " + API_TOKEN };
  }
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
  }

  // ---- Upload ----
  async function uploadFile(f) {
    setUploadStatus(spinner("Subiendo fichero…"));
    try {
      var fd = new FormData();
      fd.append("file", f);
      var res = await fetch(API_BASE + "/datasource/uploadfile", {
        method: "POST",
        headers: authHeaders(),
        body: fd
      });
      if (!res.ok) {
        var txt = await res.text().catch(function() { return ""; });
        throw new Error("HTTP " + res.status + (txt ? " – " + txt.slice(0, 120) : ""));
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
        var res = await fetch(API_BASE + "/datasource/listfiles/", {
          headers: authHeaders()
        });
        if (!res.ok) return;
        var data = await res.json().catch(function() { return null; });
        if (fileFoundInList(data, filename)) {
          clearInterval(state.polling);
          state.uploaded = true;
          setUploadStatus(checkIcon("Fichero disponible en la plataforma: " + filename));
          $("btnPlaybook").disabled = false;
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
    $("resultBox").innerHTML = '<div class="result-running"><div class="spinner"></div> Ejecutando análisis… puede tardar unos minutos.</div>';

    try {
      var msg = "incluye en la variable {documentos} el fichero denominado " + state.file.name;
      var res = await fetch(
        API_BASE + "/playbooks/invoke/analisis-de-diseno-inicial-de-arquitectura",
        {
          method: "POST",
          headers: Object.assign({}, authHeaders(), { "Content-Type": "application/json" }),
          body: JSON.stringify({ msg: msg })
        }
      );
      var txt = await res.text();
      var content;
      try {
        var json = JSON.parse(txt);
        content = json.result || json.output || json.response || json.message || JSON.stringify(json, null, 2);
      } catch (_) {
        content = txt;
      }
      if (!res.ok) throw new Error("HTTP " + res.status + " – " + (content || "").slice(0, 200));
      $("resultBox").textContent = content;
    } catch (e) {
      $("resultBox").innerHTML = '<span style="color:#f87171">Error al ejecutar el playbook: ' + escHtml(e.message) + '</span>';
    } finally {
      $("btnPlaybook").disabled = false;
    }
  });

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
  }

  function escHtml(s) {
    return (s || "").replace(/[&<>"']/g, function(c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
})();

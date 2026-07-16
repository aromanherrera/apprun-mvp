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
  var state = { file: null, filename: null, uploaded: false, polling: null, analysisType: null, lastResults: [], projectName: "", currentRunId: null };

  // Priority by category prefix — covers both short IDs (PS_01) and namespaced ones (ID_CA_01)
  // Extract the "domain" part: the segment before the last _NN numeric suffix
  // e.g. "ID_CA_01" → domain "CA", "PS_01" → "PS", "AC_02" → "AC"
  var PRIORITY_ALTO_PREFIXES = {
    // Identity & access — critical
    "CA":1, "IA":1, "AC":1,
    // Incident response & audit
    "IR":1, "AU":1,
    // Data security & protection
    "DS":1, "SC":1,
    // System integrity
    "SI":1,
    // Authentication / privileged
    "PS":1, "AP":1
  };
  var PRIORITY_BAJO_PREFIXES = {
    "IC":1, "DLP":1, "MA":1, "MP":1, "CP":1, "SA":1, "PM":1
  };

  function getControlPriority(controlKey) {
    var k = (controlKey || "").trim().toUpperCase();
    // Extract domain: strip trailing _NN suffix(es) and any leading namespace prefix like "ID_"
    // Pattern: optional "XX_" prefix + DOMAIN + _NN
    var parts = k.split("_");
    // Try last two parts that could be DOMAIN_NN
    var domain = null;
    for (var i = parts.length - 2; i >= 0; i--) {
      if (/^\d+$/.test(parts[i + 1]) && /^[A-Z]{2,4}$/.test(parts[i])) {
        domain = parts[i];
        break;
      }
    }
    if (!domain) domain = parts[0];
    if (PRIORITY_BAJO_PREFIXES[domain]) return "Bajo";
    if (PRIORITY_ALTO_PREFIXES[domain]) {
      // Only ~25% of alto-domain controls are truly Alto; use number to spread
      var num = parseInt((parts[parts.length - 1] || "0"), 10) || 0;
      // Controls numbered 01-03 in alto domains → Alto; rest → Medio
      return num <= 3 ? "Alto" : "Medio";
    }
    return "Medio";
  }
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
    var projects;
    try { projects = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch(_) { projects = []; }
    // Retroactively populate phases from existing runs and persist back
    var dirty = false;
    projects.forEach(function(proj) {
      if (!proj.phases) { proj.phases = {}; dirty = true; }
      (proj.runs || []).forEach(function(run) {
        var t = run.analysisType;
        var d = run.date || new Date().toISOString();
        if (!proj.phases.arquitectura && (t === "arquitectura" || (run.modules && run.modules.some(function(m){ return /arquitectura|marcos/i.test(m); })))) {
          proj.phases.arquitectura = d; dirty = true;
        }
        if (!proj.phases.formulario && (t === "formulario" || t === "evidencias" || (run.modules && run.modules.some(function(m){ return /triaje|formulario|scoping/i.test(m); })))) {
          // Only set formulario from formulario/triaje runs, not evidencias
          if (t === "formulario" || (run.modules && run.modules.some(function(m){ return /triaje|formulario|scoping/i.test(m); }))) {
            proj.phases.formulario = d; dirty = true;
          }
        }
        if (!proj.phases.evidencias && t === "evidencias") {
          proj.phases.evidencias = d; dirty = true;
        }
      });
    });
    if (dirty) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); } catch(_) {} }
    return projects;
  }
  function saveProjects(projects) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); } catch(_) {}
  }
  function saveRun(run) {
    var projects = loadProjects();
    var name = run.projectName || "Sin nombre";
    var proj = projects.find(function(p) { return p.name === name; });
    if (!proj) { proj = { name: name, runs: [], phases: {} }; projects.unshift(proj); }
    if (!proj.phases) proj.phases = {};
    // Mark phase as done
    var phaseKey = run.analysisType === "arquitectura" ? "arquitectura" : (run.analysisType === "evidencias" ? "evidencias" : "formulario");
    proj.phases[phaseKey] = run.date;
    // If formulario done, unlock evidencias
    if (phaseKey === "evidencias") proj.phases.informe = run.date;
    proj.runs.unshift(run);
    if (proj.runs.length > 5) proj.runs = proj.runs.slice(0, 5);
    if (projects.length > 20) projects = projects.slice(0, 20);
    saveProjects(projects);
    state.currentRunId = run.id;
    renderSidebar();
    renderProgressBar(proj.name);
  }

  // ================================================================
  // PHASE PROGRESS BAR
  // ================================================================
  var PHASES = [
    { key: "arquitectura", label: "Análisis de\narquitectura", optional: true },
    { key: "formulario",   label: "Formulario\nde triaje",    optional: false },
    { key: "evidencias",   label: "Análisis de\nevidencias",  optional: false },
    { key: "informe",      label: "Generación\nde informe",   optional: false }
  ];

  function renderProgressBar(projName) {
    var bar = document.getElementById("phaseBar");
    var inner = document.getElementById("phaseBarInner");
    if (!bar || !inner) return;
    var proj = projName ? loadProjects().find(function(p){ return p.name === projName; }) : null;
    if (!proj) { bar.style.display = "none"; return; }
    bar.style.display = "block";
    var phases = proj.phases || {};

    // Active phase logic:
    // Arquitectura is OPTIONAL — it never blocks progression.
    // Progress is driven by: formulario → evidencias → informe
    var activeKey = null;
    if (!phases.formulario)   activeKey = "formulario";
    else if (!phases.evidencias) activeKey = "evidencias";
    else if (!phases.informe) activeKey = "informe";
    // (all done → no active, all green)

    // Count mandatory phases done for progress line width
    var mandatory = ["formulario","evidencias","informe"];
    var mandatoryDone = mandatory.filter(function(k){ return !!phases[k]; }).length;
    // Line spans from node 2 to node 4 (3 segments across 4 nodes)
    // Each mandatory phase adds 1/3 of the total span
    var linePct = mandatoryDone / 3 * 100; // % of the connector line to fill green

    var checkSvg = '<svg width="13" height="11" viewBox="0 0 13 11" fill="none"><path d="M1 5.5l4 4 7-9" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    inner.innerHTML = '<div class="phase-connector" id="phaseConnector"></div>';

    PHASES.forEach(function(ph, idx) {
      var done = !!phases[ph.key];
      var active = ph.key === activeKey;
      var cls = "phase-step" + (done ? " done" : "") + (active ? " active" : "");
      var nodeContent = done ? checkSvg : String(idx + 1);
      var labelLines = ph.label.split("\n").join("<br>");
      var optHtml = ph.optional ? '<div class="phase-optional">Opcional</div>' : '';
      var step = document.createElement("div");
      step.className = cls;
      step.innerHTML =
        '<div class="phase-node">' + nodeContent + '</div>' +
        '<div class="phase-label">' + labelLines + '</div>' +
        optHtml;
      inner.appendChild(step);
    });

    // Animate green line
    setTimeout(function() {
      var conn = document.getElementById("phaseConnector");
      if (conn) conn.style.width = linePct + "%";
    }, 50);
  }

  // ================================================================
  // RISK CALCULATION
  // ================================================================

  // Shared control-count extractor — same 3-tier logic as buildStatCards
  function extractControlCounts(text) {
    // Tier 1: badge classes in rendered HTML
    var tmp = document.createElement("div");
    tmp.innerHTML = renderMarkdown(text);
    var si = tmp.querySelectorAll(".badge-si,.badge-aplicable").length;
    var no = tmp.querySelectorAll(".badge-no").length;
    var na = tmp.querySelectorAll(".badge-na").length;
    var parcial = tmp.querySelectorAll(".badge-parcial").length;
    if (si + no + na + parcial > 0) return { si: si, no: no, na: na, parcial: parcial, total: si + no + na + parcial };

    // Tier 2: raw markdown table scan
    var raw = countStatusesFromMarkdown(text);
    if (raw.si + raw.no + raw.na + raw.parcial > 0)
      return { si: raw.si, no: raw.no, na: raw.na, parcial: raw.parcial, total: raw.si + raw.no + raw.na + raw.parcial };

    // Tier 3: regex "Label: number" — extract first number as total
    var re = /(?:[-*•]\s+)?\*{0,2}([^:\n*]{4,60}?)\*{0,2}:\s*\*{0,2}(\d+)\*{0,2}/g;
    var m, seen = {}, totalFallback = 0, labels = [];
    while ((m = re.exec(text)) !== null) {
      var lbl = m[1].trim(); var val = parseInt(m[2]);
      if (lbl.split(" ").length > 8 || seen[lbl]) continue;
      seen[lbl] = true; labels.push({ lbl: lbl, val: val }); totalFallback += val;
      if (labels.length >= 5) break;
    }
    if (labels.length) {
      // Best guess: first entry = total, rest = sub-counts
      var guessTotal = labels[0].val;
      return { si: guessTotal, no: 0, na: 0, parcial: 0, total: guessTotal };
    }
    return { si: 0, no: 0, na: 0, parcial: 0, total: 0 };
  }

  // Store counts + inherente on run for persistence (called once on first display)
  function ensureRiskStored(run) {
    if (run.riesgoInherente !== undefined) return; // already computed
    var text = (run.results || []).map(function(r){ return r.text || ""; }).join("\n");
    var c = extractControlCounts(text);
    if (!c.total) return;
    var applicable = c.si + c.parcial;
    // Inherente: más controles aplicables → mayor superficie de riesgo (escala 0-4)
    run.riesgoInherente = Math.round(Math.min(4, applicable / c.total * 4) * 10) / 10;
    run.controlTotal = c.total;
    run.controlApplicable = applicable;
    // Persist
    var projects = loadProjects();
    var saved = false;
    projects.forEach(function(p) {
      (p.runs || []).forEach(function(r) {
        if (r.id === run.id) {
          r.riesgoInherente = run.riesgoInherente;
          r.controlTotal = run.controlTotal;
          r.controlApplicable = run.controlApplicable;
          saved = true;
        }
      });
    });
    if (saved) saveProjects(projects);
  }

  function calculateRisks(run) {
    if (!run || run.analysisType !== "formulario") return null;

    // Ensure inherente is stored; use cached values when available
    ensureRiskStored(run);

    var inherente = run.riesgoInherente;
    var total = run.controlTotal || 0;
    var applicable = run.controlApplicable || 0;

    // If still no data, try parsing now (edge case for very old runs)
    if (inherente === undefined) {
      var text = (run.results || []).map(function(r){ return r.text || ""; }).join("\n");
      var c = extractControlCounts(text);
      if (!c.total) return null;
      total = c.total;
      applicable = c.si + c.parcial;
      inherente = Math.round(Math.min(4, applicable / total * 4) * 10) / 10;
    }
    if (!total) return null;

    // Validations
    var validations = run.validations || {};
    var answered = 0, cumpleCount = 0;
    Object.keys(validations).forEach(function(k) {
      var v = validations[k]; if (!v) return;
      if (v.compliance) { answered++; if (v.compliance === "cumple") cumpleCount++; }
      else if (v.method === "evidencia") answered++;
    });

    var pctRespondidos = Math.round(answered / total * 100);
    var pctCumplimiento = answered > 0 ? Math.round(cumpleCount / answered * 100) : 0;
    // Residual: baja al validar como cumple, se mantiene con no_cumple o sin validar
    var divisor = Math.max(applicable, 1);
    var residual = Math.round(Math.max(0, inherente * (1 - (cumpleCount / divisor) * 0.9)) * 10) / 10;

    return { inherente: inherente, residual: residual, pctRespondidos: pctRespondidos, pctCumplimiento: pctCumplimiento, answered: answered, total: total };
  }

  function riskColor(val) {
    if (val <= 1) return "#3a6b0e";
    if (val <= 2) return "#92640a";
    if (val <= 3) return "#c45d00";
    return "#8b1a1a";
  }
  function riskBarColor(val) {
    if (val <= 1) return "#4a9b1a";
    if (val <= 2) return "#d97706";
    if (val <= 3) return "#e85800";
    return "#c00000";
  }

  function buildRiskCardsHtml(risks) {
    if (!risks) return "";
    function pctCard(label, val, sub, extraCls) {
      return '<div class="risk-card rc-pct' + (extraCls ? " " + extraCls : "") + '">' +
        '<div class="risk-label">' + escHtml(label) + '</div>' +
        '<div class="risk-val" style="color:var(--black)">' + val + '%</div>' +
        '<div class="risk-sub">' + escHtml(sub) + '</div>' +
        '<div class="risk-bar-track"><div class="risk-bar-fill" style="width:' + val + '%;background:var(--green)"></div></div>' +
        '</div>';
    }
    function riskNumCard(label, val, cls) {
      var color = riskColor(val);
      var barColor = riskBarColor(val);
      var barPct = (val / 4 * 100).toFixed(0);
      return '<div class="risk-card ' + cls + '">' +
        '<div class="risk-label">' + escHtml(label) + '</div>' +
        '<div class="risk-val" style="color:' + color + '">' + val.toFixed(1) + '</div>' +
        '<div class="risk-sub">Escala 0 – 4</div>' +
        '<div class="risk-bar-track"><div class="risk-bar-fill" style="width:' + barPct + '%;background:' + barColor + '"></div></div>' +
        '</div>';
    }
    return '<div class="risk-cards-row">' +
      pctCard("Requisitos respondidos", risks.pctRespondidos, risks.answered + " de " + risks.total) +
      riskNumCard("Riesgo inherente", risks.inherente, "rc-danger") +
      riskNumCard("Riesgo residual", risks.residual, "rc-residual") +
      pctCard("Cumplimiento", risks.pctCumplimiento, risks.answered ? risks.answered + " respondidos" : "Sin validar") +
      '</div>';
  }

  function updateRiskCards(run) {
    var container = document.getElementById("riskCardsSection");
    if (!container) return;
    var risks = calculateRisks(run);
    container.innerHTML = risks ? buildRiskCardsHtml(risks) : "";
  }

  // ================================================================
  // VALIDATION DRAWER (global, exposed via window)
  // ================================================================
  window._valState = { runId: null, controlKey: null, compliance: null };
  window._valEvidFiles = [];

  function loadRunById(runId) {
    var found = null;
    loadProjects().forEach(function(p) {
      (p.runs || []).forEach(function(r) { if (r.id === runId) found = r; });
    });
    return found;
  }

  window.openValDrawerFromBtn = function(btn) {
    openValDrawer(Number(btn.dataset.runid) || btn.dataset.runid, btn.dataset.key, btn.dataset.label || btn.dataset.key);
  };

  function openValDrawer(runId, controlKey, controlLabel) {
    var drawer = document.getElementById("valDrawer");
    var overlay = document.getElementById("valOverlay");
    if (!drawer) return;
    window._valState = { runId: runId, controlKey: controlKey, compliance: null };

    var run = loadRunById(runId);
    var existing = run && run.validations && run.validations[controlKey] ? run.validations[controlKey] : null;

    document.getElementById("valDrawerTitle").textContent = controlLabel || controlKey;

    var method = existing ? (existing.method || "manual") : "manual";
    setValMethod(method);

    // Fill manual panel
    document.getElementById("valManualNotes").value = (existing && existing.method === "manual") ? (existing.notes || "") : "";
    var comp = (existing && existing.compliance) || null;
    window._valState.compliance = comp;
    var btnC = document.getElementById("valBtnCumple");
    var btnN = document.getElementById("valBtnNoCumple");
    if (btnC) btnC.className = "val-comp-btn" + (comp === "cumple" ? " sel-cumple" : "");
    if (btnN) btnN.className = "val-comp-btn" + (comp === "no_cumple" ? " sel-no_cumple" : "");

    // Fill evidencia compliance buttons
    var evidComp = (existing && existing.method === "evidencia" && existing.compliance) || null;
    var btnCE = $("valBtnCumpleEvid"); var btnNE = $("valBtnNoCumpleEvid");
    if (btnCE) btnCE.className = "val-comp-btn" + (evidComp === "cumple" ? " sel-cumple" : "");
    if (btnNE) btnNE.className = "val-comp-btn" + (evidComp === "no_cumple" ? " sel-no_cumple" : "");

    // Fill evidencia panel (AI analysis tab)
    window._valState.currentControlKey   = controlKey;
    window._valState.currentControlLabel = controlLabel;
    window.clearAiEvidFile && window.clearAiEvidFile();
    var savedAiResult = _aiEvidLoadResult(runId, controlKey);
    var resultEl2 = $("aiEvidResult"); var clearBtn2 = $("aiEvidClearBtn");
    if (savedAiResult) {
      if (resultEl2) resultEl2.innerHTML = _renderAiEvidResult(savedAiResult);
      if (clearBtn2) clearBtn2.style.display = "";
    } else {
      if (resultEl2) resultEl2.innerHTML = "";
      if (clearBtn2) clearBtn2.style.display = "none";
    }

    // Fill conectar / CrowdStrike panel
    var isCs = /PS.?01/i.test(controlKey);
    var csPanelWrap = document.getElementById("csPanelWrap");
    var csPlaceholder = document.getElementById("csPlaceholderWrap");
    if (csPanelWrap) csPanelWrap.style.display = isCs ? "" : "none";
    if (csPlaceholder) csPlaceholder.style.display = isCs ? "none" : "";
    if (isCs) {
      var existingHosts = (existing && existing.method === "conectar" && existing.csHostnames) ? existing.csHostnames.join("\n") : "";
      document.getElementById("csHostnames").value = existingHosts;
      var savedHtml = (existing && existing.method === "conectar" && existing.csResultsHtml) ? existing.csResultsHtml : "";
      document.getElementById("csResults").innerHTML = savedHtml;
      document.getElementById("csComplianceSection").style.display = savedHtml ? "" : "none";
      var csComp = (existing && existing.method === "conectar" && existing.compliance) || null;
      window._valState.compliance = csComp;
      var btnC2 = document.getElementById("valBtnCumpleCs");
      var btnN2 = document.getElementById("valBtnNoCumpleCs");
      if (btnC2) btnC2.className = "val-comp-btn" + (csComp === "cumple" ? " sel-cumple" : "");
      if (btnN2) btnN2.className = "val-comp-btn" + (csComp === "no_cumple" ? " sel-no_cumple" : "");
      window._valState.csResultsHtml = savedHtml;
      window._valState.csResults = (existing && existing.csResults) || [];
    }

    drawer.classList.add("open");
    overlay.classList.add("open");
  }
  window.openValDrawer = openValDrawer;

  window.closeValDrawer = function() {
    var drawer = document.getElementById("valDrawer");
    var overlay = document.getElementById("valOverlay");
    if (drawer) drawer.classList.remove("open");
    if (overlay) overlay.classList.remove("open");
  };

  window.setValMethod = function(method) {
    document.querySelectorAll(".val-tab").forEach(function(t) {
      t.classList.toggle("active", t.dataset.method === method);
    });
    document.getElementById("valPanelManual").style.display = method === "manual" ? "" : "none";
    document.getElementById("valPanelEvidencia").style.display = method === "evidencia" ? "" : "none";
    document.getElementById("valPanelConectar").style.display = method === "conectar" ? "" : "none";
    window._valState.currentMethod = method;
  };
  function setValMethod(m) { window.setValMethod(m); }

  window.setValCompliance = function(val) {
    window._valState.compliance = window._valState.compliance === val ? null : val;
    var c = window._valState.compliance;
    // Sync all compliance button pairs
    [["valBtnCumple","valBtnNoCumple"],["valBtnCumpleEvid","valBtnNoCumpleEvid"],["valBtnCumpleCs","valBtnNoCumpleCs"]].forEach(function(pair) {
      var bC = document.getElementById(pair[0]); var bN = document.getElementById(pair[1]);
      if (bC) bC.className = "val-comp-btn" + (c === "cumple" ? " sel-cumple" : "");
      if (bN) bN.className = "val-comp-btn" + (c === "no_cumple" ? " sel-no_cumple" : "");
    });
    // Auto-save when in evidencia mode so state persists without clicking Guardar
    _autoSaveEvidCompliance();
  };

  window.handleEvidFiles = function(input) {
    for (var i = 0; i < input.files.length; i++) {
      var fname = input.files[i].name;
      if (window._valEvidFiles.indexOf(fname) === -1) window._valEvidFiles.push(fname);
    }
    updateEvidFileListUI();
    input.value = "";
  };

  window.removeEvidFile = function(idx) {
    window._valEvidFiles.splice(idx, 1);
    updateEvidFileListUI();
  };

  function updateEvidFileListUI() {
    var list = document.getElementById("valEvidFileList");
    if (!list) return;
    list.innerHTML = window._valEvidFiles.map(function(f, i) {
      return '<div class="val-file-item"><span>📄 ' + escHtml(f) + '</span><button class="val-file-remove" onclick="removeEvidFile(' + i + ')">×</button></div>';
    }).join("");
  }

  function renderCsResults(results) {
    return results.map(function(r) {
      if (!r.found) {
        return '<div class="cs-result cs-result-notfound">' +
          '<div class="cs-result-host">' + escHtml(r.hostname) + '</div>' +
          '<div class="cs-notfound">✗ No encontrado en la consola de CrowdStrike</div>' +
          '</div>';
      }
      var SVG_OK  = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><polyline points="1.5,6 4.5,9.5 10.5,2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      var SVG_NO  = '<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      var SVG_UNK = '<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      var mlIcon = r.ml_enabled === true ? SVG_OK : (r.ml_enabled === false ? SVG_NO : SVG_UNK);
      var mlCls  = r.ml_enabled === true ? 'cs-val-ok' : (r.ml_enabled === false ? 'cs-val-no' : 'cs-val-unknown');
      var extIcon = r.extended_user_mode === true ? SVG_OK : (r.extended_user_mode === false ? SVG_NO : SVG_UNK);
      var extCls  = r.extended_user_mode === true ? 'cs-val-ok' : (r.extended_user_mode === false ? 'cs-val-no' : 'cs-val-unknown');
      return '<div class="cs-result cs-result-found">' +
        '<div class="cs-result-host">' + escHtml(r.hostname) + ' <span class="cs-badge cs-online">Registrado</span></div>' +
        '<div class="cs-result-grid">' +
          (r.platform ? '<div class="cs-kv"><span class="cs-k">Plataforma</span><span class="cs-v">' + escHtml(r.platform) + '</span></div>' : '') +
          (r.group_name ? '<div class="cs-kv"><span class="cs-k">Grupo</span><span class="cs-v">' + escHtml(r.group_name) + '</span></div>' : '') +
          (r.policy_name ? '<div class="cs-kv" style="grid-column:1/-1"><span class="cs-k">Política aplicada</span><span class="cs-v">' + escHtml(r.policy_name) + '</span></div>' : '') +
          (r.policy_description ? '<div class="cs-kv" style="grid-column:1/-1"><span class="cs-k">Descripción</span><span class="cs-v" style="font-size:10px;line-height:1.5">' + escHtml(r.policy_description) + '</span></div>' : '') +
        '</div>' +
        '<div class="cs-checks">' +
          '<div class="cs-check"><span class="cs-check-icon ' + mlCls + '">' + mlIcon + '</span><span class="cs-check-label">Machine Learning (prevención)</span></div>' +
          '<div class="cs-check"><span class="cs-check-icon ' + extCls + '">' + extIcon + '</span><span class="cs-check-label">Extended user mode data visibility</span></div>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  var CS_BASE    = "https://api.eu-1.crowdstrike.com";
  var CS_ID      = "2626bff7eaf74bea87e2ff3e95c20bf4";
  var CS_SECRET  = "bCxStEHn8QUDiz62Gj9PK7WOy3lAg0sf1M5mk4pL";

  function csGetToken() {
    return fetch(CS_BASE + "/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&client_id=" + CS_ID + "&client_secret=" + CS_SECRET
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (!d.access_token) throw new Error("No se pudo obtener token de CrowdStrike");
      return d.access_token;
    });
  }

  function csGet(path, token, params) {
    var url = CS_BASE + path;
    if (params) url += "?" + new URLSearchParams(params).toString();
    return fetch(url, { headers: { "Authorization": "Bearer " + token } }).then(function(r) { return r.json(); });
  }

  window.queryCrowdstrike = function() {
    var hostsRaw = (document.getElementById("csHostnames").value || "").trim();
    if (!hostsRaw) { alert("Introduce al menos un nombre de equipo."); return; }
    var hostnames = hostsRaw.split(/[\n,]+/).map(function(h){ return h.trim().toUpperCase(); }).filter(Boolean);

    var btn = document.getElementById("csQueryBtn");
    var resultsDiv = document.getElementById("csResults");
    var compSection = document.getElementById("csComplianceSection");
    if (btn) { btn.disabled = true; btn.textContent = "Consultando…"; }
    resultsDiv.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-500);font-size:12px">Conectando con CrowdStrike…</div>';
    if (compSection) compSection.style.display = "none";

    csGetToken().then(function(token) {
      return Promise.all([
        csGet("/devices/combined/host-groups/v1", token, { limit: 100 }),
        csGet("/policy/combined/prevention/v1", token, { limit: 100 })
      ]).then(function(responses) {
        var groups   = (responses[0].resources || []);
        var policies = (responses[1].resources || []);

        var results = hostnames.map(function(hostname) {
          // find group containing this hostname in assignment_rule
          var group = null;
          for (var i = 0; i < groups.length; i++) {
            var rule = (groups[i].assignment_rule || "").toUpperCase();
            if (rule.indexOf("HOSTNAME:[") !== -1) {
              var m = rule.match(/HOSTNAME:\[([^\]]*)\]/);
              if (m) {
                var names = m[1].split(",").map(function(n){ return n.replace(/['"]/g,"").trim(); });
                if (names.indexOf(hostname) !== -1) { group = groups[i]; break; }
              }
            }
          }
          if (!group) return { hostname: hostname, found: false };

          // find policy that applies to this group
          var policy = null;
          for (var j = 0; j < policies.length; j++) {
            var pg = policies[j].groups || [];
            for (var k = 0; k < pg.length; k++) {
              if (pg[k].id === group.id) { policy = policies[j]; break; }
            }
            if (policy) break;
          }

          // extract ML and extended user mode settings
          var ml_enabled = null;
          var extended_user_mode = null;
          if (policy) {
            var classes = policy.prevention_settings && policy.prevention_settings.classes || [];
            classes.forEach(function(cls) {
              (cls.settings || []).forEach(function(s) {
                var sid = (s.id || "").toLowerCase();
                if (sid === "cloud_anti_malware" || sid === "sensor_anti_malware") {
                  var v = s.value || {};
                  if (v.prevention !== undefined && ml_enabled === null) ml_enabled = v.prevention;
                  else if (v.enabled !== undefined && ml_enabled === null) ml_enabled = v.enabled;
                }
                if (sid.indexOf("extended") !== -1 && sid.indexOf("user") !== -1) {
                  var v2 = s.value || {};
                  extended_user_mode = v2.enabled !== undefined ? v2.enabled : (v2.prevention !== undefined ? v2.prevention : null);
                }
              });
            });
          }

          return {
            hostname: hostname,
            found: true,
            group_name: group.name || "",
            policy_name: policy ? policy.name : "",
            policy_description: policy ? policy.description : "",
            platform: group.assignment_rule && group.assignment_rule.match(/platform_name:'([^']+)'/i) ? group.assignment_rule.match(/platform_name:'([^']+)'/i)[1] : "",
            ml_enabled: ml_enabled,
            extended_user_mode: extended_user_mode
          };
        });

        if (btn) { btn.disabled = false; btn.textContent = "Volver a consultar"; }
        var html = renderCsResults(results);
        resultsDiv.innerHTML = html;
        window._valState.csResults = results;
        window._valState.csResultsHtml = html;
        if (compSection) compSection.style.display = "";
      });
    }).catch(function(err) {
      if (btn) { btn.disabled = false; btn.textContent = "Consultar CrowdStrike"; }
      resultsDiv.innerHTML = '<div class="cs-error">Error al conectar con CrowdStrike: ' + escHtml(err.message || String(err)) + '</div>';
    });
  };

  window.saveValidation = function() {
    var st = window._valState;
    var method = st.currentMethod || "manual";
    var validation = { method: method, compliance: null, notes: "", evidenceFiles: [], updatedAt: new Date().toISOString() };

    if (method === "manual") {
      if (!st.compliance) { alert("Selecciona si el control Cumple o No cumple."); return; }
      validation.compliance = st.compliance;
      validation.notes = (document.getElementById("valManualNotes").value || "").trim();
    } else if (method === "evidencia") {
      if (!st.compliance) { alert("Selecciona si el control Cumple o No cumple."); return; }
      validation.compliance = st.compliance;
      validation.notes = (document.getElementById("aiEvidNotes") ? document.getElementById("aiEvidNotes").value : "").trim();
      validation.evidenceFiles = [];
    } else if (method === "conectar") {
      var csPanel = document.getElementById("csPanelWrap");
      var csActive = csPanel && csPanel.style.display !== "none";
      if (csActive) {
        if (!st.compliance) { alert("Selecciona si el control Cumple o No cumple."); return; }
        validation.compliance = st.compliance;
        var hostsVal = (document.getElementById("csHostnames").value || "").trim();
        validation.csHostnames = hostsVal ? hostsVal.split(/[\n,]+/).map(function(h){ return h.trim(); }).filter(Boolean) : [];
        validation.csResults = st.csResults || [];
        validation.csResultsHtml = st.csResultsHtml || "";
      }
    }

    var projects = loadProjects();
    var savedRun = null;
    projects.forEach(function(p) {
      (p.runs || []).forEach(function(r) {
        if (r.id === st.runId) {
          if (!r.validations) r.validations = {};
          // Preserve AI evidence result across saves
          var prevAiResult = r.validations[st.controlKey] && r.validations[st.controlKey].aiEvidResult;
          if (prevAiResult && !validation.aiEvidResult) validation.aiEvidResult = prevAiResult;
          r.validations[st.controlKey] = validation;
          savedRun = r;
        }
      });
    });
    if (!savedRun) { alert("No se encontró el análisis. Recarga la página."); return; }
    ensureRiskStored(savedRun);
    saveProjects(projects);

    // Update button in table
    var btns = document.querySelectorAll(".val-btn[data-key]");
    btns.forEach(function(btn) {
      if (btn.dataset.key === st.controlKey) {
        var lbl = validation.compliance === "cumple" ? "✓ Cumple" : (validation.compliance === "no_cumple" ? "✗ No cumple" : "📄 Con evidencia");
        btn.textContent = lbl;
        btn.className = "val-btn" + (validation.compliance ? " val-btn-" + validation.compliance : "");
        // Row highlight
        var row = btn.closest("tr");
        if (row) row.className = validation.compliance === "cumple" ? "val-row-cumple" : (validation.compliance === "no_cumple" ? "val-row-nocumple" : "");
      }
    });

    updateRiskCards(savedRun);
    window.closeValDrawer();
  };

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
      // Phase mini-indicator
      var ph = proj.phases || {};
      var doneCount = ["arquitectura","formulario","evidencias","informe"].filter(function(k){ return !!ph[k]; }).length;
      var total = 4;
      var phaseDots = '';
      ["arquitectura","formulario","evidencias","informe"].forEach(function(k) {
        var isDone = !!ph[k];
        var isOpt = k === "arquitectura";
        phaseDots += '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-left:3px;background:' + (isDone ? 'var(--green)' : (isOpt ? 'var(--gray-200)' : 'var(--gray-200)')) + ';border:1px solid ' + (isDone ? 'var(--green)' : 'var(--gray-200)') + '"></span>';
      });
      var nameSpan = document.createElement("span");
      nameSpan.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text";
      nameSpan.textContent = proj.name;
      nameSpan.title = "Doble clic para renombrar";
      (function(projRef, nameSpanRef) {
        nameSpanRef.addEventListener("dblclick", function(e) {
          e.stopPropagation();
          var input = document.createElement("input");
          input.value = projRef.name;
          input.style.cssText = "flex:1;min-width:0;background:transparent;border:none;border-bottom:1px solid var(--green);outline:none;font-size:12px;font-weight:700;color:inherit;font-family:inherit;padding:0 2px";
          nameSpanRef.replaceWith(input);
          input.focus(); input.select();
          function commit() {
            var newName = input.value.trim();
            if (newName && newName !== projRef.name) {
              var ps = loadProjects();
              ps.forEach(function(p) {
                if (p.name === projRef.name) {
                  p.name = newName;
                  (p.runs || []).forEach(function(r) { r.projectName = newName; });
                }
              });
              saveProjects(ps);
              renderSidebar();
            } else {
              renderSidebar();
            }
          }
          input.addEventListener("blur", commit);
          input.addEventListener("keydown", function(ev) {
            if (ev.key === "Enter") { input.blur(); }
            if (ev.key === "Escape") { input.value = projRef.name; input.blur(); }
          });
        });
      })(proj, nameSpan);
      nameDiv.appendChild(nameSpan);
      var dotsSpan = document.createElement("span");
      dotsSpan.style.cssText = "display:flex;align-items:center;gap:0;flex-shrink:0";
      dotsSpan.innerHTML = phaseDots;
      nameDiv.appendChild(dotsSpan);
      var chevron = document.createElement("span");
      chevron.className = "sb-chevron";
      chevron.style.marginLeft = "6px";
      chevron.innerHTML = "&#9656;";
      nameDiv.appendChild(chevron);
      nameDiv.onclick = function(e) { if (e.target !== nameSpan) div.classList.toggle("open"); };
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
    // Show phase bar for this project
    var projects = loadProjects();
    var proj = projects.find(function(p){ return p.name === (run.projectName || "Sin nombre"); });
    renderProgressBar(proj ? proj.name : null);
    // Show next-phase button based on project state
    var btnEv = $("btnStartEvidencias");
    if (btnEv && proj && proj.phases) {
      var ph = proj.phases;
      if (!ph.formulario && !ph.arquitectura) {
        // Nothing done yet — no next button
        btnEv.style.display = "none";
      } else if (ph.arquitectura && !ph.formulario) {
        // Arquitectura done, formulario pending → offer triaje
        btnEv.textContent = "Iniciar formulario de triaje";
        btnEv.style.display = "inline-block";
        btnEv.dataset.projName = proj.name;
        btnEv.dataset.nextPhase = "formulario";
      } else if (ph.formulario && !ph.evidencias) {
        // Formulario done, evidencias pending → offer evidencias
        btnEv.textContent = "Iniciar análisis de evidencias";
        btnEv.style.display = "inline-block";
        btnEv.dataset.projName = proj.name;
        btnEv.dataset.nextPhase = "evidencias";
      } else {
        btnEv.style.display = "none";
      }
    } else if (btnEv) {
      btnEv.style.display = "none";
    }
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
    var html = buildResultsHtml(run.results || [], false, { id: run.id, analysisType: run.analysisType, validations: run.validations || {}, elapsedMs: run.elapsedMs || null });
    $("hvContent").innerHTML = html;
    if (run.analysisType === "formulario") { ensureRiskStored(run); updateRiskCards(run); }
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
  window._archiaSelectEvidencias = function() {
    // Reuse formulario flow but mark as evidencias analysis type
    state.analysisType = "evidencias";
    ["typeArquitectura","typeFormulario"].forEach(function(id){ $(id).classList.remove("selected"); });
    resetSubSteps();
    $("stepUpload").style.display = "block";
    $("uploadDesc").textContent = "Adjunta las evidencias de cumplimiento de controles. Formatos: .doc, .docx, .pdf, .md";
    $("executeStepLabel").textContent = "Paso 3 — Ejecución";
    $("stepUpload").scrollIntoView({ behavior:"smooth", block:"start" });
  };

  window.selectType = function(type) {
    ["typeArquitectura","typeFormulario"].forEach(function(id){ $(id).classList.remove("selected"); });
    $(type === "arquitectura" ? "typeArquitectura" : "typeFormulario").classList.add("selected");
    state.analysisType = type;
    state.arqTypes = ["completo"]; // multi-select array
    resetSubSteps();
    if (type === "arquitectura") {
      // Show type selection FIRST, then document upload
      $("stepOpciones").style.display = "block";
      $("stepUpload").style.display = "block";
      $("uploadDesc").textContent = "Adjunta el documento o imagen de arquitectura a analizar. Formatos: .doc, .docx, .pdf, .md, .jpg, .png…";
      $("executeStepLabel").textContent = "Paso 4 — Ejecución";
      $("opcionesStepLabel").textContent = "Paso 2 — Configuración";
      $("uploadStepLabel").textContent = "Paso 3 — Documentación";
      $("stepOpciones").scrollIntoView({ behavior:"smooth", block:"start" });
    } else {
      $("stepUpload").style.display = "block";
      $("uploadDesc").textContent = "Adjunta el cuestionario o formulario a analizar. Formatos: .doc, .docx, .pdf, .md";
      $("executeStepLabel").textContent = "Paso 3 — Ejecución";
      $("stepUpload").scrollIntoView({ behavior:"smooth", block:"start" });
    }
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
      var allowed = [".doc",".docx",".pdf",".md",".jpg",".jpeg",".png",".gif",".svg",".webp",".bmp",".tif",".tiff"];
      var ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
      if (!allowed.includes(ext)) {
        setUploadStatus(errorIcon("Formato no admitido: " + ext + ". Usa .doc, .docx, .pdf, .md o imagen"));
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
    state._startTs = Date.now();
    $("btnPlaybook").disabled = true;
    $("playbookStatus").textContent = "";
    $("resultCard").style.display = "block";
    $("resultBox").style.display = "none";
    $("resultSpinner").style.display = "flex";
    $("resultCard").scrollIntoView({ behavior:"smooth", block:"start" });

    if (state.analysisType === "arquitectura") await runArquitectura();
    else await runFormulario(); // formulario + evidencias use same playbook flow

    $("btnPlaybook").disabled = false;
  });

  async function runFormulario() {
    var query = "poner en {cuestionario} el fichero con el nombre " + state.file.name;
    var results = await Promise.allSettled([invokePlaybook("sep-01scoping-secarch", query)]);
    var labels = [state.analysisType === "evidencias" ? "Análisis de evidencias" : "Formulario de triaje"];
    finalizeResults(results, labels);
  }

  async function runArquitectura() {
    var arqTypes = state.arqTypes || ["completo"];
    var ctxFilename = state.arqCtxFilename || "";
    var modulosStr = arqTypes.join(",");
    var query = "incluye en la variable {documento} el fichero denominado " + state.file.name +
      "\nincluye en la variable {modulos} el valor: " + modulosStr;
    if (ctxFilename) query += "\nincluye en la variable {contexto} el fichero denominado " + ctxFilename;
    else query += "\nla variable {contexto} viene vacía";

    // Navegación no tiene playbook activo aún — se excluye silenciosamente
    var activeTypes = arqTypes.filter(function(t) { return t !== "navegacion"; });
    if (arqTypes.includes("completo")) activeTypes = ["completo"];

    var jobs = [], labels = [];
    if (activeTypes.includes("completo") || (!activeTypes.length && arqTypes.includes("completo"))) {
      // Completo: una sola llamada pasando modulos=completo (navegacion excluida por ahora)
      var queryCompleto = query.replace("el valor: completo", "el valor: publicacion,powerbi");
      jobs = [invokePlaybook("analisis-hld", queryCompleto)];
      labels = ["Análisis completo"];
    } else {
      if (activeTypes.includes("publicacion")) { jobs.push(invokePlaybook("analisis-hld", query)); labels.push("Arquitectura de publicación"); }
      if (activeTypes.includes("powerbi"))     { jobs.push(invokePlaybook("analisis-hld", query)); labels.push("Arquitectura de PowerBI"); }
      if (!jobs.length) { jobs = [invokePlaybook("analisis-hld", query)]; labels = ["Análisis de arquitectura"]; }
    }
    var results = await Promise.allSettled(jobs);
    finalizeResults(results, labels);
  }

  function finalizeResults(results, labels) {
    var elapsedMs = state._startTs ? (Date.now() - state._startTs) : null;
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
      results: stored,
      elapsedMs: elapsedMs
    });

    var runCtx = { id: state.currentRunId, analysisType: state.analysisType, validations: {}, elapsedMs: elapsedMs };
    var html = buildResultsHtml(stored, true, runCtx);
    $("resultSpinner").style.display = "none";
    $("resultBox").style.display = "block";
    $("resultBox").innerHTML = html;
    if (state.analysisType === "formulario") {
      var freshRun = loadRunById(state.currentRunId);
      if (freshRun) { ensureRiskStored(freshRun); updateRiskCards(freshRun); }
    }
    var hasData = stored.some(function(r){ return r.text; });
    $("btnDownloadWord").style.display = hasData ? "inline-block" : "none";
    // Update phase bar
    var projects = loadProjects();
    var proj = projects.find(function(p){ return p.name === (state.projectName || "Sin nombre"); });
    renderProgressBar(proj ? proj.name : null);
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

  function buildResultsHtml(stored, multiSection, runCtx) {
    var isFormulario = !!(runCtx && runCtx.analysisType === "formulario");
    var isArquitectura = !!(runCtx && runCtx.analysisType === "arquitectura");
    var mdOpts = isFormulario ? { isFormulario: true, runId: runCtx.id, validations: runCtx.validations || {} } : null;

    // Elapsed time banner
    var elapsed = runCtx && runCtx.elapsedMs;
    var elapsedHtml = "";
    if (elapsed) {
      var secs = Math.round(elapsed / 1000);
      var mins = Math.floor(secs / 60); secs = secs % 60;
      var elapsedStr = mins > 0 ? mins + " min " + secs + " s" : secs + " s";
      elapsedHtml = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:11px;color:rgba(255,255,255,.35);font-weight:600;letter-spacing:.06em;text-transform:uppercase">' +
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2"/><path d="M6 3v3l2 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
        'Tiempo de ejecución: <span style="color:rgba(255,255,255,.6)">' + elapsedStr + '</span></div>';
    }

    var allHtml = "";
    stored.forEach(function(r, i) {
      // Try to render as HLD JSON table first (arquitectura results)
      var hldHtml = isArquitectura && r.text ? tryRenderHldResult(r.text) : null;
      var sectionHtml;
      if (hldHtml) {
        sectionHtml = hldHtml;
      } else {
        var bodyText = r.text ? stripSummarySection(r.text) : null;
        sectionHtml = bodyText ? renderMarkdown(bodyText, mdOpts) : '<p style="color:var(--red)">Error al procesar este módulo.</p>';
      }
      if (multiSection && stored.length > 1) {
        allHtml += '<div class="result-section-label">' + escHtml(r.label) + '</div>';
      }
      allHtml += '<div class="result-body">' + sectionHtml + '</div>';
      if (i < stored.length - 1) allHtml += '<hr style="border:none;border-top:1px solid var(--border);margin:24px 0">';
    });

    // Stat cards (always shown, except arquitectura which has its own layout)
    var combinedText = stored.map(function(r){ return r.text || ""; }).join("\n");
    var statHtml = isArquitectura ? "" : buildStatCards(combinedText);
    // Risk cards placeholder (only for formulario — populated after DOM insertion)
    var riskPlaceholder = isFormulario ? '<div id="riskCardsSection"></div>' : "";
    // Priority chart (formulario only)
    var prioHtml = isFormulario ? buildPriorityChartHtml(combinedText) : "";
    return elapsedHtml + statHtml + riskPlaceholder + prioHtml + allHtml;
  }

  function tryRenderHldResult(text) {
    var data = null;
    try {
      var match = text.match(/\{[\s\S]*\}/);
      if (match) data = JSON.parse(match[0]);
    } catch(_) {}
    if (!data || !data.controles) return null;

    var controles = data.controles || [];
    var modulos = (data.modulos_analizados || []).join(", ");

    // Summary chips
    var cumple = controles.filter(function(c){ return c.estado === "cumple"; }).length;
    var noCumple = controles.filter(function(c){ return c.estado === "no_cumple"; }).length;
    var noId = controles.filter(function(c){ return c.estado === "no_identificado"; }).length;

    var html = '';
    // Module tag + summary row
    if (modulos) {
      html += '<div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:12px">Módulos: ' + escHtml(modulos) + '</div>';
    }
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">';
    html += '<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(134,188,37,.1);border:1px solid rgba(134,188,37,.2);border-radius:3px"><span style="font-size:16px;font-weight:800;color:#86BC25">' + cumple + '</span><span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.4)">Cumple</span></div>';
    html += '<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:3px"><span style="font-size:16px;font-weight:800;color:#ef4444">' + noCumple + '</span><span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.4)">No cumple</span></div>';
    html += '<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:3px"><span style="font-size:16px;font-weight:800;color:rgba(255,255,255,.5)">' + noId + '</span><span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.4)">No identificado</span></div>';
    html += '<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:3px"><span style="font-size:16px;font-weight:800;color:rgba(255,255,255,.7)">' + controles.length + '</span><span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.4)">Total controles</span></div>';
    html += '</div>';

    // Table
    html += '<div class="tbl-wrap"><table><thead><tr>' +
      '<th style="width:72px">ID</th>' +
      '<th style="width:180px">Control</th>' +
      '<th>Descripción (referencia)</th>' +
      '<th style="width:110px">Estado</th>' +
      '<th>Justificación</th>' +
      '</tr></thead><tbody>';

    controles.forEach(function(c) {
      var estado = (c.estado || "").toLowerCase();
      var estadoBadge, rowCls;
      if (estado === "cumple") {
        estadoBadge = '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:rgba(134,188,37,.12);color:#86BC25;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:2px">✓ Cumple</span>';
        rowCls = '';
      } else if (estado === "no_cumple") {
        estadoBadge = '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:rgba(239,68,68,.12);color:#ef4444;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:2px">✗ No cumple</span>';
        rowCls = ' class="val-row-nocumple"';
      } else {
        estadoBadge = '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.4);font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:2px">— No ident.</span>';
        rowCls = '';
      }
      html += '<tr' + rowCls + '>' +
        '<td style="font-family:monospace;font-size:11px;font-weight:700;color:var(--green);white-space:nowrap">' + escHtml(c.id || "") + '</td>' +
        '<td style="font-weight:600">' + escHtml(c.nombre || "") + '</td>' +
        '<td style="font-size:12px;color:rgba(255,255,255,.55)">' + escHtml(c.descripcion_referencia || "") + '</td>' +
        '<td>' + estadoBadge + '</td>' +
        '<td style="font-size:12px">' + escHtml(c.justificacion || "") + '</td>' +
        '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  // ================================================================
  // STAT CARDS (big numbers)
  // ================================================================
  function countStatusesFromMarkdown(text) {
    // Parse markdown tables and count values in the status/estado column
    var counts = { si: 0, no: 0, na: 0, parcial: 0 };
    var lines = (text || "").split("\n");
    var inTable = false;
    var statusColIdx = -1;
    var headerParsed = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line.startsWith("|")) {
        if (inTable) { inTable = false; statusColIdx = -1; headerParsed = false; }
        continue;
      }
      var cells = line.split("|").slice(1, -1).map(function(c){ return c.trim(); });
      if (!headerParsed) {
        // Find status column from header
        inTable = true; headerParsed = true;
        statusColIdx = -1;
        cells.forEach(function(c, idx) {
          var cl = c.toLowerCase().replace(/\*/g,"").trim();
          if (/estado|status|aplicabilidad|result/.test(cl)) statusColIdx = idx;
        });
        continue;
      }
      if (/^[\s|:-]+$/.test(line)) continue; // separator row
      if (statusColIdx < 0 || statusColIdx >= cells.length) continue;
      var val = cells[statusColIdx].toLowerCase().replace(/\*/g,"").replace(/\[|\]/g,"").trim();
      if (val === "sí" || val === "si" || val === "yes" || val === "aplicable" || val === "✓") counts.si++;
      else if (val === "no" || val === "no aplica" || val === "no aplican") counts.no++;
      else if (val === "n/a" || val === "na") counts.na++;
      else if (val === "parcial" || val === "partial") counts.parcial++;
      else if (val) counts.si++; // unknown non-empty status → count as identified control
    }
    return counts;
  }

  function buildStatCards(text) {
    var cards = [];

    // Priority 1: count status badges from rendered HTML
    var tmp = document.createElement("div");
    tmp.innerHTML = renderMarkdown(text);
    var si      = tmp.querySelectorAll(".badge-si,.badge-aplicable").length;
    var no      = tmp.querySelectorAll(".badge-no").length;
    var na      = tmp.querySelectorAll(".badge-na").length;
    var parcial = tmp.querySelectorAll(".badge-parcial").length;
    var badgeTotal = si + no + na + parcial;

    // Priority 2: if badges didn't render, scan raw markdown table cells
    if (badgeTotal === 0) {
      var raw = countStatusesFromMarkdown(text);
      si = raw.si; no = raw.no; na = raw.na; parcial = raw.parcial;
      badgeTotal = si + no + na + parcial;
    }

    if (badgeTotal > 0) {
      function pct(n) { return badgeTotal > 0 ? Math.round(n / badgeTotal * 100) + "%" : ""; }
      cards.push({ cls:"sc-total",   num:badgeTotal, label:"Total controles", pct:"" });
      if (si)      cards.push({ cls:"sc-si",      num:si,      label:"Aplicables", pct:pct(si) });
      if (no)      cards.push({ cls:"sc-no",      num:no,      label:"No aplican", pct:pct(no) });
      if (na)      cards.push({ cls:"sc-na",      num:na,      label:"N/A",        pct:pct(na) });
      if (parcial) cards.push({ cls:"sc-parcial", num:parcial, label:"Parcial",    pct:pct(parcial) });
    } else {
      // Priority 3: regex "Label: number" patterns from summary text
      var re = /(?:[-*•]\s+)?\*{0,2}([^:\n*]{4,60}?)\*{0,2}:\s*\*{0,2}(\d+)\*{0,2}/g;
      var m; var seen = new Set();
      while ((m = re.exec(text)) !== null) {
        var label = m[1].trim().replace(/^["'""]/g,"").replace(/["'""]$/g,"");
        var val = parseInt(m[2]);
        if (label.split(" ").length > 8 || seen.has(label)) continue;
        seen.add(label);
        var clsList = ["sc-total","sc-si","sc-no","sc-na","sc-parcial"];
        cards.push({ cls: clsList[Math.min(cards.length, clsList.length-1)], num: val, label: label, pct: "" });
        if (cards.length >= 5) break;
      }
    }

    if (!cards.length) return "";

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
  // PRIORITY CHART
  // ================================================================
  function buildPriorityChartHtml(text) {
    // Count applicable controls by priority from the markdown table
    var alto = 0, medio = 0, bajo = 0;
    var tmp = document.createElement("div");
    tmp.innerHTML = renderMarkdown(text);
    var rows = tmp.querySelectorAll("table tbody tr");
    rows.forEach(function(row) {
      var cells = row.querySelectorAll("td");
      if (!cells.length) return;
      var controlKey = (cells[0] ? cells[0].textContent : "").trim();
      // Only count applicable/sí rows
      var hasApplicable = false;
      for (var i = 1; i < cells.length; i++) {
        var cel = (cells[i].textContent || "").toLowerCase().trim();
        if (cel === "sí" || cel === "si" || cel === "aplicable" || cel === "parcial") { hasApplicable = true; break; }
      }
      if (!hasApplicable) return;
      var p = getControlPriority(controlKey);
      if (p === "Alto") alto++;
      else if (p === "Bajo") bajo++;
      else medio++;
    });
    var total = alto + medio + bajo;
    if (!total) return "";

    function bar(label, count, color, bg) {
      var pct = Math.round(count / total * 100);
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0">' +
        '<div style="width:50px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:' + color + ';text-align:right;flex-shrink:0">' + label + '</div>' +
        '<div style="flex:1;height:18px;background:rgba(255,255,255,.05);border-radius:2px;overflow:hidden">' +
          '<div style="height:100%;width:' + pct + '%;background:' + color + ';opacity:.85;transition:width .4s"></div>' +
        '</div>' +
        '<div style="width:56px;flex-shrink:0;font-size:11px;color:rgba(255,255,255,.55)">' + count + ' <span style="font-size:10px;color:rgba(255,255,255,.3)">(' + pct + '%)</span></div>' +
        '</div>';
    }

    return '<div style="margin-bottom:20px;padding:16px 18px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:6px">' +
      '<div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.35);margin-bottom:10px">Distribución de prioridad — controles aplicables</div>' +
      bar("Alto", alto, "#ef4444") +
      bar("Medio", medio, "#f59e0b") +
      bar("Bajo", bajo, "#86BC25") +
      '</div>';
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
    var ct = $("arqDocToggle"); if (ct) { ct.classList.remove("on"); ct.setAttribute("aria-checked","false"); }
    var cw = $("arqContextWrap"); if (cw) cw.style.display = "none";
    if (typeof clearArqCtxFile === "function") clearArqCtxFile();
    $("resultCard").style.display = "none"; $("resultSpinner").style.display = "none";
    $("resultBox").style.display = "none"; $("resultBox").innerHTML = "";
    var btnW = $("btnDownloadWord"); if (btnW) btnW.style.display = "none";
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

  function renderMarkdown(md, opts) {
    var lines = (md||"").split("\n"), out = [], inTable = false, tableRows = [];
    function flushTable() {
      if (!tableRows.length) return;
      var header = tableRows[0], body = tableRows.slice(2);
      var isFormulario = !!(opts && opts.isFormulario);
      var runId = opts && opts.runId;
      var validations = (opts && opts.validations) || {};
      var html = '<div class="tbl-wrap"><table><thead><tr>';
      html += header.map(function(c){ return "<th>"+inlineRender(c)+"</th>"; }).join("");
      if (isFormulario) html += '<th style="width:80px">Prioridad</th><th style="width:110px">Validación</th>';
      html += "</tr></thead><tbody>";
      body.forEach(function(row, rowIdx){
        var controlKey = (row[0] || ("row-" + rowIdx)).trim();
        var val = validations[controlKey] || null;
        var compliance = val && val.compliance;
        var rowCls = compliance === "cumple" ? " class=\"val-row-cumple\"" : (compliance === "no_cumple" ? " class=\"val-row-nocumple\"" : "");
        html += "<tr" + rowCls + ">" + row.map(function(c, ci){
          return "<td>" + (ci > 0 ? statusBadge(c) : inlineRender(c)) + "</td>";
        }).join("");
        if (isFormulario) {
          var prio = getControlPriority(controlKey);
          html += '<td>' + statusBadge(prio) + '</td>';
          var btnLbl = compliance === "cumple" ? "✓ Cumple" : (compliance === "no_cumple" ? "✗ No cumple" : (val && val.method === "evidencia" ? "📄 Con evidencia" : "Validar"));
          var btnCls = compliance ? (" val-btn-" + compliance) : "";
          html += '<td><button class="val-btn' + btnCls + '" data-key="' + escHtml(controlKey) + '" data-runid="' + escHtml(String(runId)) + '" data-label="' + escHtml(controlKey) + '" onclick="openValDrawerFromBtn(this)">' + escHtml(btnLbl) + '</button></td>';
        }
        html += "</tr>";
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

  // Show phase bar when project name matches a saved project
  var pnInput = $("projectName");
  if (pnInput) {
    pnInput.addEventListener("input", function() {
      var name = pnInput.value.trim();
      var projects = loadProjects();
      var proj = projects.find(function(p){ return p.name.toLowerCase() === name.toLowerCase(); });
      renderProgressBar(proj ? proj.name : null);
    });
  }

  // ================================================================
  // INIT
  // ================================================================
  renderSidebar();
  renderProgressBar(null);

  // ================================================================
  // AI EVIDENCE ANALYSIS (Analizar evidencia panel)
  // ================================================================
  var _aiEvid = { file: null, filename: null, uploaded: false, polling: null };

  window.handleAiEvidFile = function(input) {
    var f = input.files && input.files[0];
    if (!f) return;
    _aiEvid.file = f;
    _aiEvid.filename = f.name; // allow sending even before upload confirms
    _aiEvid.uploaded = false;
    var info = $("aiEvidFileInfo");
    if (info) info.style.display = "flex";
    var drop = $("aiEvidDrop");
    if (drop) drop.style.display = "none";
    var nameEl = $("aiEvidFileName");
    if (nameEl) nameEl.textContent = f.name;
    var statusEl = $("aiEvidUploadStatus");
    if (statusEl) statusEl.innerHTML = spinner("Subiendo…");
    // Enable button immediately so user isn't blocked
    var btn = $("aiEvidBtn");
    if (btn) { btn.disabled = false; btn.style.opacity = "1"; }
    _aiEvidUpload(f);
  };

  async function _aiEvidUpload(f) {
    var statusEl = $("aiEvidUploadStatus");
    function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }
    try {
      var fd = new FormData(); fd.append("file", f);
      var res = await apiFetch(API_BASE + "/datasource/uploadfile/", { method:"POST", headers:authHeaders(), body:fd });
      if (!res.ok) {
        // Check if already exists
        var listRes = await apiFetch(API_BASE + "/datasource/listfiles/", { headers:authHeaders() });
        var data = null; try { data = JSON.parse(listRes.text); } catch(_) {}
        if (listRes.ok && fileFoundInList(data, f.name)) {
          _aiEvid.filename = f.name; _aiEvid.uploaded = true;
          setStatus(checkIcon("Disponible"));
          var btn = $("aiEvidBtn"); if (btn) btn.disabled = false;
          return;
        }
        throw new Error("HTTP " + res.status);
      }
      setStatus(spinner("Verificando…"));
      _aiEvidPollFile(f.name);
    } catch(e) {
      // Non-blocking: keep button enabled, just show warning
      setStatus('<span style="color:#f59e0b">⚠ No se pudo confirmar subida — se intentará al analizar</span>');
    }
  }

  function _aiEvidPollFile(filename) {
    clearInterval(_aiEvid.polling);
    var attempts = 0; var maxAttempts = 6; // 30s then assume available
    _aiEvid.polling = setInterval(async function() {
      attempts++;
      try {
        var res = await apiFetch(API_BASE + "/datasource/listfiles/", { headers:authHeaders() });
        if (res.ok) {
          var data = null; try { data = JSON.parse(res.text); } catch(_) {}
          if (fileFoundInList(data, filename)) {
            clearInterval(_aiEvid.polling);
            _aiEvid.uploaded = true;
            var statusEl = $("aiEvidUploadStatus");
            if (statusEl) statusEl.innerHTML = checkIcon("Disponible");
            return;
          }
        }
      } catch(_) {}
      if (attempts >= maxAttempts) {
        clearInterval(_aiEvid.polling);
        _aiEvid.uploaded = true;
        var statusEl = $("aiEvidUploadStatus");
        if (statusEl) statusEl.innerHTML = checkIcon("Subido");
      }
    }, POLL_INTERVAL);
  }

  function _aiEvidSaveResult(text) {
    var st = window._valState || {};
    if (!st.runId || !st.currentControlKey) return;
    var projects = loadProjects();
    projects.forEach(function(p) {
      (p.runs || []).forEach(function(r) {
        if (r.id === st.runId) {
          if (!r.validations) r.validations = {};
          if (!r.validations[st.currentControlKey]) r.validations[st.currentControlKey] = {};
          r.validations[st.currentControlKey].aiEvidResult = text;
          r.validations[st.currentControlKey].method = "evidencia";
          if (st.compliance) r.validations[st.currentControlKey].compliance = st.compliance;
        }
      });
    });
    saveProjects(projects);
    _syncValBtnInTable();
  }

  function _autoSaveEvidCompliance() {
    var st = window._valState || {};
    if (!st.runId || !st.currentControlKey || st.currentMethod !== "evidencia") return;
    var projects = loadProjects();
    var savedRun = null;
    projects.forEach(function(p) {
      (p.runs || []).forEach(function(r) {
        if (r.id === st.runId) {
          if (!r.validations) r.validations = {};
          if (!r.validations[st.currentControlKey]) r.validations[st.currentControlKey] = {};
          r.validations[st.currentControlKey].method = "evidencia";
          r.validations[st.currentControlKey].compliance = st.compliance || null;
          savedRun = r;
        }
      });
    });
    if (savedRun) { saveProjects(projects); ensureRiskStored(savedRun); updateRiskCards(savedRun); }
    _syncValBtnInTable();
  }

  function _syncValBtnInTable() {
    var st = window._valState || {};
    if (!st.controlKey) return;
    var run = loadRunById(st.runId);
    var v = run && run.validations && run.validations[st.controlKey];
    if (!v) return;
    document.querySelectorAll(".val-btn[data-key]").forEach(function(btn) {
      if (btn.dataset.key !== st.controlKey) return;
      var lbl = v.compliance === "cumple" ? "✓ Cumple" : (v.compliance === "no_cumple" ? "✗ No cumple" : "📄 Con evidencia");
      btn.textContent = lbl;
      btn.className = "val-btn" + (v.compliance ? " val-btn-" + v.compliance : "");
      var row = btn.closest("tr");
      if (row) row.className = v.compliance === "cumple" ? "val-row-cumple" : (v.compliance === "no_cumple" ? "val-row-nocumple" : "");
    });
  }

  function _aiEvidLoadResult(runId, controlKey) {
    var run = loadRunById(runId);
    return run && run.validations && run.validations[controlKey] && run.validations[controlKey].aiEvidResult || null;
  }

  window.clearAiEvidAnalysis = function() {
    var st = window._valState || {};
    if (st.runId && st.currentControlKey) {
      var projects = loadProjects();
      projects.forEach(function(p) {
        (p.runs || []).forEach(function(r) {
          if (r.id === st.runId && r.validations && r.validations[st.currentControlKey]) {
            delete r.validations[st.currentControlKey].aiEvidResult;
          }
        });
      });
      saveProjects(projects);
    }
    var res = $("aiEvidResult"); if (res) res.innerHTML = "";
    var st2 = $("aiEvidStatus"); if (st2) st2.innerHTML = "";
    var clearBtn = $("aiEvidClearBtn"); if (clearBtn) clearBtn.style.display = "none";
    window.clearAiEvidFile();
  };

  window.clearAiEvidFile = function() {
    clearInterval(_aiEvid.polling);
    _aiEvid = { file: null, filename: null, uploaded: false, polling: null };
    var fi = $("aiEvidFile"); if (fi) fi.value = "";
    var info = $("aiEvidFileInfo"); if (info) info.style.display = "none";
    var drop = $("aiEvidDrop"); if (drop) drop.style.display = "";
    var btn = $("aiEvidBtn"); if (btn) { btn.disabled = true; btn.style.opacity = ".45"; }
    var res = $("aiEvidResult"); if (res) res.innerHTML = "";
    var st = $("aiEvidStatus"); if (st) st.innerHTML = "";
  };

  window.runAiAnalysis = async function() {
    var btn = $("aiEvidBtn");
    var statusEl = $("aiEvidStatus");
    var resultEl = $("aiEvidResult");
    if (!statusEl || !resultEl) return;

    var vs = window._valState || {};
    var controlKey   = vs.currentControlKey   || "";
    var controlLabel = vs.currentControlLabel || "";
    var requisito = controlKey ? (controlKey + (controlLabel ? " – " + controlLabel : "")) : controlLabel;
    var evidencia   = _aiEvid.filename || "";
    var comentarios = ($("aiEvidNotes") || {}).value || "";

    if (!requisito) { statusEl.innerHTML = errorIcon("No hay control seleccionado."); return; }

    if (btn) { btn.disabled = true; btn.textContent = "Analizando…"; }
    statusEl.innerHTML = spinner("Enviando análisis…");
    resultEl.innerHTML = "";

    try {
      var queryStr = "Requisito: " + requisito + "\nEvidencia: " + (evidencia || "ninguna") + (comentarios ? "\nComentarios: " + comentarios : "");
      var invokeBody = { query: queryStr };
      resultEl.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word;font-size:11px;color:rgba(255,255,255,.6);background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);padding:12px;border-radius:6px">Enviando:\n' + escHtml(JSON.stringify(invokeBody, null, 2)) + '</pre>';
      var res = await apiFetch(API_BASE + "/playbooks/invoke/analisis-evidencias", {
        method: "POST",
        headers: Object.assign({}, authHeaders(), { "Content-Type": "application/json" }),
        body: JSON.stringify(invokeBody)
      });
      var rawInvoke = res.text;
      resultEl.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word;font-size:11px;color:rgba(255,255,255,.6);background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);padding:12px;border-radius:6px">Invoke response (HTTP ' + res.status + '):\n' + escHtml(rawInvoke) + '</pre>';
      if (!res.ok) throw new Error("HTTP " + res.status + " – " + rawInvoke.slice(0, 200));
      var json; try { json = JSON.parse(rawInvoke); } catch(_) { throw new Error("Respuesta no es JSON"); }
      var taskId = json.id || json.task_id || json.taskId || (json.status && json.status.id) || null;
      if (!taskId) throw new Error("Sin task ID: " + JSON.stringify(json).slice(0, 200));
      statusEl.innerHTML = spinner("Analizando con IA… (task: " + taskId + ")");
      var result = await pollTask(taskId);
      statusEl.innerHTML = "";
      resultEl.innerHTML = _renderAiEvidResult(result.text);
      // Persist result
      _aiEvidSaveResult(result.text);
      var clearBtn = $("aiEvidClearBtn"); if (clearBtn) clearBtn.style.display = "";
    } catch(e) {
      statusEl.innerHTML = errorIcon("Error: " + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Analizar evidencia con IA"; }
    }
  };

  function _renderAiEvidResult(text) {
    var data = null;
    try {
      var match = text.match(/\{[\s\S]*\}/);
      if (match) data = JSON.parse(match[0]);
    } catch(_) {}

    if (!data) {
      return '<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;color:rgba(255,255,255,.8);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);padding:12px;border-radius:6px">' + escHtml(text) + '</pre>';
    }

    // Vulnerability scanner result (tipo_analisis === "vulnerabilidades")
    if (data.tipo_analisis === "vulnerabilidades") {
      return _renderVulnResult(data);
    }

    var veredictoRaw = data.veredicto || "";
    var vLo = veredictoRaw.toUpperCase();
    var isCumple  = vLo === "CUMPLE";
    var isParcial = vLo.includes("PARCIAL");
    var isNoCumple = vLo.includes("NO CUMPLE") || (!isCumple && !isParcial);

    var pct       = parseInt(data.porcentaje_validez || data.porcentaje || 0, 10);
    var resumen   = data.resumen || "";
    var justif    = data.justificacion || data.justificación || "";
    var cubiertos = data.aspectos_cubiertos  || [];
    var faltantes = data.aspectos_faltantes  || [];

    var accentColor = isCumple ? "#86BC25" : isParcial ? "#f59e0b" : "#ef4444";
    var borderColor = isCumple ? "rgba(134,188,37,.25)" : isParcial ? "rgba(245,158,11,.25)" : "rgba(239,68,68,.25)";
    var icon        = isCumple ? "✓" : isParcial ? "~" : "✗";

    function listHtml(arr, bullet, bulletColor) {
      if (!arr || !arr.length) return "";
      return '<ul style="margin:6px 0 0;padding:0;list-style:none">' +
        arr.map(function(i) {
          return '<li style="display:flex;gap:8px;padding:4px 0;font-size:12px;color:rgba(255,255,255,.7);border-bottom:1px solid rgba(255,255,255,.04)">' +
            '<span style="color:' + bulletColor + ';flex-shrink:0;font-weight:700">' + bullet + '</span>' +
            '<span>' + escHtml(i) + '</span></li>';
        }).join("") + '</ul>';
    }

    var h = '';
    h += '<div style="border:1px solid ' + borderColor + ';border-radius:8px;overflow:hidden;margin-top:8px;background:#111">';
    // Header row
    h += '<div style="padding:12px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,.06)">';
    h += '<span style="width:26px;height:26px;border-radius:50%;background:' + accentColor + ';display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:#000;flex-shrink:0">' + icon + '</span>';
    h += '<div style="flex:1;font-size:13px;font-weight:800;letter-spacing:.04em;color:' + accentColor + '">' + escHtml(veredictoRaw) + '</div>';
    if (!isNaN(pct) && pct > 0) {
      h += '<div style="text-align:right;flex-shrink:0"><span style="font-size:18px;font-weight:900;color:' + accentColor + '">' + pct + '</span><span style="font-size:10px;color:rgba(255,255,255,.35)">%</span></div>';
    }
    h += '</div>';
    // Progress bar
    if (!isNaN(pct) && pct > 0) {
      h += '<div style="height:2px;background:rgba(255,255,255,.05)"><div style="height:100%;width:' + Math.min(pct,100) + '%;background:' + accentColor + '"></div></div>';
    }
    // Body
    h += '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:10px">';
    if (resumen) h += '<div style="font-size:12px;color:rgba(255,255,255,.6);font-style:italic">' + escHtml(resumen) + '</div>';
    if (justif)  h += '<div style="font-size:12px;color:rgba(255,255,255,.75);line-height:1.6">' + escHtml(justif) + '</div>';
    if (cubiertos.length) {
      h += '<div><div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:2px">Aspectos cubiertos</div>';
      h += listHtml(cubiertos, "✓", "#86BC25") + '</div>';
    }
    if (faltantes.length) {
      h += '<div><div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:2px">Aspectos faltantes</div>';
      h += listHtml(faltantes, "✗", "#ef4444") + '</div>';
    }
    h += '</div></div>';
    return h;
  }

  function _renderVulnResult(data) {
    var veredictoRaw = data.veredicto || "";
    var vLo = veredictoRaw.toUpperCase();
    var isCumple  = vLo === "CUMPLE";
    var isParcial = vLo.includes("PARCIAL");

    var pct         = Math.round(parseFloat(data.porcentaje_cumplimiento) || 0);
    var justif      = data.justificacion || data.justificación || "";
    var maquina     = data.maquina || "Global";
    var conteo      = data.conteo || {};
    var critical    = conteo.critical || 0;
    var high        = conteo.high || 0;
    var medium      = conteo.medium || 0;
    var low         = conteo.low || 0;
    var total       = conteo.total || (critical + high + medium + low);

    var accentColor = isCumple ? "#86BC25" : isParcial ? "#f59e0b" : "#ef4444";
    var borderColor = isCumple ? "rgba(134,188,37,.25)" : isParcial ? "rgba(245,158,11,.25)" : "rgba(239,68,68,.25)";
    var icon        = isCumple ? "✓" : isParcial ? "~" : "✗";

    var vulnRows = [
      { label: "Critical", count: critical, color: "#ef4444" },
      { label: "High",     count: high,     color: "#f97316" },
      { label: "Medium",   count: medium,   color: "#f59e0b" },
      { label: "Low",      count: low,      color: "#86BC25" }
    ];

    var h = '';
    h += '<div style="border:1px solid ' + borderColor + ';border-radius:8px;overflow:hidden;margin-top:8px;background:#111">';

    // Header
    h += '<div style="padding:12px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,.06)">';
    h += '<span style="width:26px;height:26px;border-radius:50%;background:' + accentColor + ';display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:#000;flex-shrink:0">' + icon + '</span>';
    h += '<div style="flex:1">';
    h += '<div style="font-size:13px;font-weight:800;letter-spacing:.04em;color:' + accentColor + '">' + escHtml(veredictoRaw) + '</div>';
    h += '<div style="font-size:10px;color:rgba(255,255,255,.35);margin-top:2px">Análisis de vulnerabilidades · ' + escHtml(maquina) + '</div>';
    h += '</div>';
    h += '<div style="text-align:right;flex-shrink:0"><span style="font-size:22px;font-weight:900;color:' + accentColor + '">' + pct + '</span><span style="font-size:11px;color:rgba(255,255,255,.35)">%</span></div>';
    h += '</div>';

    // Progress bar
    h += '<div style="height:3px;background:rgba(255,255,255,.05)"><div style="height:100%;width:' + Math.min(pct, 100) + '%;background:' + accentColor + ';transition:width .4s"></div></div>';

    // Vulnerability breakdown
    h += '<div style="padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.06)">';
    h += '<div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:10px">Vulnerabilidades detectadas · ' + total + ' total</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">';
    vulnRows.forEach(function(v) {
      h += '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:8px 10px;text-align:center">';
      h += '<div style="font-size:20px;font-weight:900;color:' + v.color + '">' + v.count + '</div>';
      h += '<div style="font-size:10px;color:rgba(255,255,255,.4);margin-top:2px">' + v.label + '</div>';
      h += '</div>';
    });
    h += '</div>';

    // Mini bar chart
    if (total > 0) {
      h += '<div style="margin-top:10px;display:flex;height:6px;border-radius:3px;overflow:hidden;gap:1px">';
      vulnRows.forEach(function(v) {
        var pctBar = Math.round((v.count / total) * 100);
        if (pctBar > 0) {
          h += '<div style="flex:' + v.count + ';background:' + v.color + ';opacity:.8" title="' + v.label + ': ' + v.count + '"></div>';
        }
      });
      h += '</div>';
    }
    h += '</div>';

    // Justification
    if (justif) {
      h += '<div style="padding:12px 14px;font-size:12px;color:rgba(255,255,255,.7);line-height:1.6">' + escHtml(justif) + '</div>';
    }

    h += '</div>';
    return h;
  }

})();

// ================================================================
// GLOBAL FUNCTIONS (called from HTML onclick)
// ================================================================
function toggleOpt(btn) { btn.classList.toggle("selected"); }

function selectArqType(type) {
  var state = window._archiaState;
  if (!state) return;
  if (!state.arqTypes) state.arqTypes = ["completo"];

  if (type === "completo") {
    // Completo is exclusive — deselect all others
    state.arqTypes = ["completo"];
  } else {
    // Remove "completo" if it was selected
    state.arqTypes = state.arqTypes.filter(function(t) { return t !== "completo"; });
    // Toggle this type
    var idx = state.arqTypes.indexOf(type);
    if (idx >= 0) { state.arqTypes.splice(idx, 1); }
    else { state.arqTypes.push(type); }
    // If nothing selected, default to completo
    if (!state.arqTypes.length) state.arqTypes = ["completo"];
  }

  // Sync UI
  var map = { completo:"arqTypeCompleto", publicacion:"arqTypePublicacion", navegacion:"arqTypeNavegacion", powerbi:"arqTypePowerBI" };
  Object.keys(map).forEach(function(t) {
    var el = document.getElementById(map[t]);
    if (!el) return;
    var sel = state.arqTypes.includes(t);
    el.classList.toggle("selected", sel);
    var check = el.querySelector(".tc-check");
    if (check) check.style.display = sel ? "flex" : "none";
  });
}

function toggleArqContext() {
  var wrap = document.getElementById("arqContextWrap");
  var toggle = document.getElementById("arqDocToggle");
  if (!wrap || !toggle) return;
  var on = toggle.classList.toggle("on");
  toggle.setAttribute("aria-checked", on ? "true" : "false");
  wrap.style.display = on ? "block" : "none";
}

function handleArqCtxFile(input) {
  var f = input.files && input.files[0];
  if (!f) return;
  if (window._archiaState) window._archiaState.arqCtxFilename = f.name;
  var info = document.getElementById("arqCtxFileInfo");
  var nameEl = document.getElementById("arqCtxFileName");
  var drop = document.getElementById("arqCtxDropZone");
  if (nameEl) nameEl.textContent = f.name;
  if (info) info.style.display = "flex";
  if (drop) drop.style.display = "none";
  // Upload context file
  var statusEl = document.getElementById("arqCtxUploadStatus");
  var API_BASE = "https://api1-soarplus-pre.es.deloitte.com";
  var API_TOKEN = "sk-UmL4haDNvWZdQ4a8ZxKb3Q";
  if (statusEl) statusEl.innerHTML = '<div class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block"></div> Subiendo…';
  var fd = new FormData(); fd.append("file", f);
  fetch(API_BASE + "/datasource/uploadfile/", { method:"POST", headers:{ Authorization:"Bearer "+API_TOKEN }, body:fd })
    .then(function(r) { if (statusEl) statusEl.innerHTML = r.ok ? '<span style="color:var(--green);font-size:11px">✓ Documento de contexto subido</span>' : '<span style="color:#f59e0b;font-size:11px">⚠ No se pudo confirmar la subida</span>'; })
    .catch(function() { if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b;font-size:11px">⚠ Error al subir</span>'; });
}

function clearArqCtxFile() {
  if (window._archiaState) window._archiaState.arqCtxFilename = "";
  var info = document.getElementById("arqCtxFileInfo");
  var drop = document.getElementById("arqCtxDropZone");
  var status = document.getElementById("arqCtxUploadStatus");
  var fi = document.getElementById("arqCtxFile");
  if (info) info.style.display = "none";
  if (drop) drop.style.display = "";
  if (status) status.innerHTML = "";
  if (fi) fi.value = "";
}

function startEvidencias() {
  var btn = document.getElementById("btnStartEvidencias");
  var projName = btn ? btn.dataset.projName : "";
  var nextPhase = btn ? btn.dataset.nextPhase : "evidencias";
  document.getElementById("historyView").style.display = "none";
  document.getElementById("wizardView").style.display = "block";
  if (projName) {
    var pn = document.getElementById("projectName");
    if (pn) pn.value = projName;
  }
  if (nextPhase === "formulario") {
    // Go to wizard with formulario pre-selected
    if (typeof window.selectType === "function") window.selectType("formulario");
  } else {
    // evidencias flow
    if (typeof window._archiaSelectEvidencias === "function") window._archiaSelectEvidencias();
  }
}

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

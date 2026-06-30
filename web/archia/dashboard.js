(function () {
  const session = ArchIA.requireSession();
  document.getElementById("userEmail").textContent = session.user?.email || session.user?.name || "";
  const apiConfigured = !!(ArchIA.getApiBase() && session.token);
  if (!apiConfigured) {
    const pill = document.getElementById("demoPill");
    pill.textContent = "API no configurada – modo simulado";
    pill.style.display = "inline-block";
  }
  document.getElementById("btnLogout").onclick = ArchIA.logout;

  const $ = (id) => document.getElementById(id);
  const state = { files: [], projectId: null, jobId: null, recommendations: [], polling: null };

  // ---- API connection settings ----
  $("apiBaseInput").value = ArchIA.getApiBase();
  $("apiTokenInput").value = session.token || "";
  $("btnApiSettings").onclick = () => { $("apiSettingsCard").style.display = "block"; };
  $("btnCancelApiSettings").onclick = () => { $("apiSettingsCard").style.display = "none"; };
  $("btnSaveApiSettings").onclick = () => {
    ArchIA.setApiBase($("apiBaseInput").value);
    ArchIA.setApiToken($("apiTokenInput").value);
    window.location.reload();
  };

  // ---- File picking / drag&drop ----
  const dropZone = $("dropZone"), fileInput = $("fileInput");
  $("btnPick").onclick = () => fileInput.click();
  fileInput.onchange = () => addFiles(fileInput.files);
  ["dragenter", "dragover"].forEach(ev => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove("over"); }));
  dropZone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  function addFiles(fileListObj) {
    Array.from(fileListObj).forEach(f => state.files.push(f));
    renderFiles();
  }
  function renderFiles() {
    const ul = $("fileList");
    ul.innerHTML = "";
    state.files.forEach((f, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${f.name} <span class="muted">(${(f.size / 1024).toFixed(0)} KB)</span></span><span class="rm" data-i="${i}">Quitar</span>`;
      ul.appendChild(li);
    });
    ul.querySelectorAll(".rm").forEach(el => el.onclick = () => {
      state.files.splice(+el.dataset.i, 1);
      renderFiles();
    });
    $("btnAnalyze").disabled = state.files.length === 0;
  }

  // ---- Analyze ----
  $("btnAnalyze").onclick = async () => {
    $("btnAnalyze").disabled = true;
    $("jobStatus").textContent = "Subiendo ficheros…";
    try {
      if (!apiConfigured) {
        await runDemoAnalysis();
      } else {
        await runRealAnalysis();
      }
    } catch (e) {
      $("jobStatus").textContent = "Error: " + e.message;
    } finally {
      $("btnAnalyze").disabled = state.files.length === 0;
    }
  };

  async function runRealAnalysis() {
    const name = $("projectName").value.trim() || "Análisis ArchIA";
    const proj = await ArchIA.apiFetch("/projects", { method: "POST", body: { name } });
    state.projectId = proj.project_id;

    for (const f of state.files) {
      const fd = new FormData();
      fd.append("file", f);
      await ArchIA.apiFetch(`/projects/${state.projectId}/files`, { method: "POST", body: fd, isForm: true });
    }

    $("jobStatus").textContent = "Ficheros enviados. Iniciando agentes…";
    const job = await ArchIA.apiFetch(`/projects/${state.projectId}/analyze`, { method: "POST", body: {} });
    state.jobId = job.job_id;
    pollJob();
  }

  function pollJob() {
    $("jobProgress").style.display = "block";
    clearInterval(state.polling);
    state.polling = setInterval(async () => {
      try {
        const job = await ArchIA.apiFetch(`/jobs/${state.jobId}`);
        $("jobProgress").value = job.progress || 0;
        $("jobStatus").innerHTML = `Estado: <span class="status-${job.status}">${job.status}</span>`;
        if (job.status === "done") {
          clearInterval(state.polling);
          state.recommendations = job.recommendations || [];
          renderRecommendations();
        } else if (job.status === "error") {
          clearInterval(state.polling);
          $("jobStatus").textContent = "Error en el análisis: " + (job.message || "desconocido");
        }
      } catch (e) {
        clearInterval(state.polling);
        $("jobStatus").textContent = "Error consultando el estado: " + e.message;
      }
    }, 2500);
  }

  // ---- Demo mode (sin backend) ----
  async function runDemoAnalysis() {
    $("jobProgress").style.display = "block";
    for (let p = 0; p <= 100; p += 20) {
      $("jobProgress").value = p;
      $("jobStatus").innerHTML = `Estado: <span class="status-running">running</span> (simulado)`;
      await new Promise(r => setTimeout(r, 300));
    }
    $("jobStatus").innerHTML = `Estado: <span class="status-done">done</span> (simulado)`;
    state.recommendations = demoRecommendations(state.files.map(f => f.name));
    renderRecommendations();
  }

  function demoRecommendations(fileNames) {
    return [
      { id: "R1", severity: "critica", title: "Credenciales en texto plano detectadas", description: `Se han encontrado posibles credenciales o secretos sin cifrar en los ficheros analizados (${fileNames.slice(0, 2).join(", ") || "documentación"}). Migrar a un gestor de secretos.` },
      { id: "R2", severity: "alta", title: "Falta de segmentación de red", description: "La arquitectura descrita no muestra separación clara entre zonas de confianza. Se recomienda introducir segmentación y reglas de firewall explícitas." },
      { id: "R3", severity: "media", title: "Cifrado en tránsito no confirmado", description: "No se referencia uso de TLS en las comunicaciones entre componentes internos. Confirmar y documentar cifrado en tránsito." },
      { id: "R4", severity: "baja", title: "Documentación de logging incompleta", description: "Los ficheros no detallan política de retención ni centralización de logs. Recomendable definir una estrategia de observabilidad de seguridad." }
    ];
  }

  function renderRecommendations() {
    const list = $("recsList");
    list.innerHTML = "";
    if (!state.recommendations.length) {
      $("recsEmpty").style.display = "block";
      $("reportCard").style.display = "none";
      return;
    }
    $("recsEmpty").style.display = "none";
    state.recommendations.forEach(r => {
      const div = document.createElement("div");
      div.className = "rec";
      div.innerHTML = `<h3>${r.title} <span class="sev sev-${r.severity}">${r.severity.toUpperCase()}</span></h3><p>${r.description}</p>`;
      list.appendChild(div);
    });
    $("reportCard").style.display = "block";
    $("summaryEdit").value = `Se han identificado ${state.recommendations.length} recomendaciones de seguridad tras el análisis de los ficheros aportados, priorizadas por severidad. Ver detalle en las secciones siguientes.`;
  }

  // ---- Report generation ----
  function buildReportPayload() {
    return {
      project_name: $("projectName").value.trim() || "Análisis ArchIA",
      generated_at: new Date().toISOString(),
      summary: $("summaryEdit").value.trim(),
      template: $("templateSelect").value,
      recommendations: state.recommendations
    };
  }

  $("btnPreview").onclick = () => {
    sessionStorage.setItem("archia_report_preview", JSON.stringify(buildReportPayload()));
    window.open("report.html", "_blank");
  };

  $("btnGenerateReport").onclick = async () => {
    $("reportStatus").textContent = "Generando entregable…";
    try {
      const payload = buildReportPayload();
      if (!apiConfigured) {
        sessionStorage.setItem("archia_report_preview", JSON.stringify(payload));
        window.open("report.html?download=1", "_blank");
        $("reportStatus").textContent = "Entregable generado (modo demo). Usa 'Imprimir > Guardar como PDF' en la pestaña abierta.";
      } else {
        const res = await ArchIA.apiFetch(`/projects/${state.projectId}/report`, { method: "POST", body: payload });
        if (res.download_url) {
          window.open(res.download_url, "_blank");
          $("reportStatus").textContent = "Entregable generado correctamente.";
        } else {
          throw new Error("Respuesta sin download_url");
        }
      }
    } catch (e) {
      $("reportStatus").textContent = "Error generando el entregable: " + e.message;
    }
  };
})();

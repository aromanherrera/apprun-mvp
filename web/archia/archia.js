/* ArchIA – cliente común (auth, API, storage)
   Contrato de API asumido (ajustar cuando exista backend real):
   POST /auth/login            {email,password} -> {token, user:{name,email}}
   POST /projects              {name} -> {project_id}
   POST /projects/:id/files    multipart/form-data (file) -> {file_id,name}
   POST /projects/:id/analyze  {} -> {job_id}
   GET  /jobs/:id               -> {status: queued|running|done|error, progress, recommendations:[...]}
   POST /projects/:id/report   {recommendations:[...], template:"default"} -> {report_id, download_url}
*/
(function (global) {
  const STORAGE_KEY = "archia_session";

  function getApiBase() {
    return localStorage.getItem("archia_api_base") || "";
  }
  function setApiBase(url) {
    localStorage.setItem("archia_api_base", (url || "").trim());
  }

  function getSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch { return null; }
  }
  function setSession(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }
  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function requireSession() {
    const s = getSession();
    if (!s || !s.token) {
      window.location.href = "index.html";
      throw new Error("No autenticado");
    }
    return s;
  }

  async function apiFetch(path, { method = "GET", body = null, isForm = false } = {}) {
    const base = getApiBase().replace(/\/+$/, "");
    if (!base) throw new Error("API Base no configurada");
    const s = getSession();
    const headers = {};
    if (s && s.token) headers["Authorization"] = "Bearer " + s.token;
    let reqBody = body;
    if (body !== null && !isForm) {
      headers["Content-Type"] = "application/json";
      reqBody = JSON.stringify(body);
    }
    const r = await fetch(base + path, { method, headers, body: reqBody });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = txt; }
    if (!r.ok) throw new Error((data && data.message) || ("HTTP " + r.status));
    return data;
  }

  // ---- Login page ----
  function initLoginPage() {
    const apiInput = document.getElementById("apiBase");
    apiInput.value = getApiBase();
    apiInput.addEventListener("change", () => setApiBase(apiInput.value));

    document.getElementById("loginForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const err = document.getElementById("err");
      err.style.display = "none";
      const btn = document.getElementById("btnLogin");
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      setApiBase(apiInput.value);
      btn.disabled = true;
      try {
        if (!getApiBase()) throw new Error("Configura la API Base URL o usa el modo demo");
        const res = await apiFetch("/auth/login", { method: "POST", body: { email, password } });
        setSession({ token: res.token, user: res.user || { email }, demo: false });
        window.location.href = "dashboard.html";
      } catch (e) {
        err.textContent = "No se pudo iniciar sesión: " + e.message;
        err.style.display = "block";
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById("btnDemo").addEventListener("click", () => {
      setSession({ token: "demo-token", user: { name: "Usuario Demo", email: "demo@archia.local" }, demo: true });
      window.location.href = "dashboard.html";
    });
  }

  function logout() {
    clearSession();
    window.location.href = "index.html";
  }

  global.ArchIA = {
    getApiBase, setApiBase,
    getSession, setSession, clearSession, requireSession,
    apiFetch, initLoginPage, logout
  };
})(window);

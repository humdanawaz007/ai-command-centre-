
/* JARVIS Core — private owner task storage */
(() => {
  "use strict";

  const LOCAL_KEY = "acc_jarvis_tasks_v1";
  const MAX_TASKS = 50;
  const panelId = "jarvis-panel";

  const styles = `
    #jarvis-panel {
      margin:18px auto;padding:18px;max-width:960px;
      border:1px solid #35c99a;border-radius:18px;
      background:#101d2d;color:#edf3ff;
      font:15px/1.5 system-ui,Arial,sans-serif;
    }
    #jarvis-panel * { box-sizing:border-box; }
    #jarvis-panel input,#jarvis-panel textarea {
      width:100%;padding:12px;margin:6px 0;
      border-radius:10px;border:1px solid #344761;
      background:#0b1422;color:#edf3ff;font:inherit;
    }
    #jarvis-panel textarea { min-height:100px; }
    #jarvis-panel button {
      padding:10px 14px;margin:5px 5px 5px 0;
      border:1px solid #35c99a;border-radius:9px;
      background:#16392f;color:#fff;font:inherit;
    }
    #jarvis-panel button:disabled { opacity:.5; }
    #jarvis-status { color:#78e3bd;margin:12px 0; }
    #jarvis-list { padding:0;list-style:none; }
    #jarvis-list li {
      padding:12px;margin:8px 0;border-radius:10px;
      background:#17263a;overflow-wrap:anywhere;
    }
    #jarvis-list small { display:block;color:#a9b8cc; }
    #jarvis-panel .danger {
      border-color:#d69a65;background:#392719;
    }
  `;

  const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);

  function localTasks() {
    try {
      const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
      return Array.isArray(v) ? v.slice(0, MAX_TASKS) : [];
    } catch {
      return [];
    }
  }

  function saveLocal(tasks) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(tasks.slice(0, MAX_TASKS)));
    } catch {}
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(data.error || "Request failed (" + response.status + ")");
      error.status = response.status;
      throw error;
    }

    return data;
  }

  function start() {
    if (document.getElementById(panelId)) return;

    const style = document.createElement("style");
    style.textContent = styles;
    document.head.appendChild(style);

    const panel = document.createElement("section");
    panel.id = panelId;
    panel.innerHTML = `
      <h2>JARVIS AI Assistant</h2>
      <p>Private task history. External actions are not executed automatically.</p>
      <div id="jarvis-login">
        <h3>Owner sign-in</h3>
        <form id="jarvis-login-form">
          <label for="jarvis-password">Owner password</label>
          <input id="jarvis-password" type="password"
            autocomplete="current-password" required>
          <button id="jarvis-login-button" type="submit">Sign in</button>
        </form>
      </div>
      <div id="jarvis-work" hidden>
        <button id="jarvis-logout" class="danger">Sign out</button>
        <textarea id="jarvis-input"
          placeholder="Example: Prepare a video script about space."></textarea>
        <button id="jarvis-plan">Ask JARVIS</button>
        <button id="jarvis-voice">🎙 Speak</button>
        <button id="jarvis-stop">Stop speaking</button>
        <div id="jarvis-status" role="status" aria-live="polite">Loading...</div>
        <h3>Saved task history</h3>
        <ul id="jarvis-list"></ul>
      </div>
    `;

    (document.querySelector("main") || document.body).appendChild(panel);

    const login = panel.querySelector("#jarvis-login");
    const loginForm = panel.querySelector("#jarvis-login-form");
    const password = panel.querySelector("#jarvis-password");
    const loginButton = panel.querySelector("#jarvis-login-button");
    const work = panel.querySelector("#jarvis-work");
    const input = panel.querySelector("#jarvis-input");
    const status = panel.querySelector("#jarvis-status");
    const list = panel.querySelector("#jarvis-list");
    const planButton = panel.querySelector("#jarvis-plan");

    let tasks = localTasks();
    let recognition = null;

    const setStatus = message => { status.textContent = message; };

    function render() {
      list.innerHTML = tasks.map(task => `
        <li>
          <strong>${escapeHTML(task.request || "")}</strong>
          <small>Status: ${escapeHTML(task.status || "Unknown")}</small>
          <small>${escapeHTML(task.created || "")}</small>
          ${task.reply ? `<p>${escapeHTML(task.reply)}</p>` : ""}
          ${task.status === "Awaiting approval" ? `
            <button data-action="approve" data-id="${escapeHTML(task.id)}">
              Approve for local use
            </button>
            <button class="danger" data-action="reject" data-id="${escapeHTML(task.id)}">
              Reject
            </button>` : ""}
        </li>
      `).join("") || "<li>No saved tasks yet.</li>";

      saveLocal(tasks);
    }

    async function updateTask(task, changes) {
      const result = await api("/api/jarvis-tasks", {
        method: "POST",
        body: JSON.stringify({
          action: "update",
          id: task.id,
          ...changes
        })
      });
      Object.assign(task, result.task);
      render();
    }

    async function loadTasks() {
      const result = await api("/api/jarvis-tasks?action=list");
      tasks = Array.isArray(result.tasks) ? result.tasks : [];
      render();
    }

    async function showSignedIn() {
      login.hidden = true;
      work.hidden = false;
      setStatus("Signed in. Loading saved tasks...");
      try {
        await loadTasks();
        setStatus("JARVIS ready. Your saved tasks are loaded.");
      } catch (error) {
        setStatus(error.status === 401
          ? "Please sign in again."
          : "Could not load saved tasks. Please retry.");
        if (error.status === 401) {
          work.hidden = true;
          login.hidden = false;
        }
      }
    }

    loginForm.addEventListener("submit", async event => {
      event.preventDefault();
      loginButton.disabled = true;
      setStatus("Signing in...");

      try {
        await api("/api/jarvis-login", {
          method: "POST",
          body: JSON.stringify({
            action: "login",
            password: password.value
          })
        });
        password.value = "";
        await showSignedIn();
      } catch {
        password.value = "";
        setStatus("Sign-in failed. Check your password and try again.");
      } finally {
        loginButton.disabled = false;
      }
    });

    panel.querySelector("#jarvis-logout").addEventListener("click", async () => {
      try {
        await api("/api/jarvis-login", {
          method: "POST",
          body: JSON.stringify({ action: "logout" })
        });
      } catch {}

      tasks = [];
      render();
      work.hidden = true;
      login.hidden = false;
      password.value = "";
      setStatus("Signed out.");
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    });

    async function askJarvis() {
      const request = input.value.trim();
      if (!request) {
        setStatus("Enter an instruction first.");
        return;
      }

      planButton.disabled = true;
      setStatus("Saving your task...");

      const id = Date.now().toString(36) +
        Math.random().toString(36).slice(2, 10);

      let task;

      try {
        const created = await api("/api/jarvis-tasks", {
          method: "POST",
          body: JSON.stringify({
            action: "create",
            id,
            request,
            created: new Date().toLocaleString()
          })
        });

        task = created.task;
        tasks.unshift(task);
        tasks = tasks.slice(0, MAX_TASKS);
        render();
      } catch (error) {
        setStatus(error.status === 401
          ? "Session expired. Please sign in again."
          : "Could not save the task. No AI request was sent.");
        if (error.status === 401) {
          work.hidden = true;
          login.hidden = false;
        }
        planButton.disabled = false;
        return;
      }

      setStatus("JARVIS is preparing a response...");

      try {
        const result = await api("/api/chat", {
          method: "POST",
          body: JSON.stringify({
            action: "chat",
            message:
              "You are JARVIS, assistant for AI Command Centre. " +
              "Help plan safe, practical content creation and business tasks. " +
              "Never claim to have executed actions you have not done. " +
              "Do not publish, spend money, send messages, or place trades. " +
              "User request: " + request
          })
        });

        if (typeof result.reply !== "string" || !result.reply.trim()) {
          throw new Error("No assistant reply was returned.");
        }

        await updateTask(task, {
          reply: result.reply.trim(),
          status: "Awaiting approval"
        });

        setStatus("Response saved. Review it before taking action.");

        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(result.reply.trim());
          utterance.lang = "en-IN";
          window.speechSynthesis.speak(utterance);
        }
      } catch {
        try {
          await updateTask(task, {
            status: "Failed",
            reply: "The AI request failed. Please retry."
          });
        } catch {}
        setStatus("AI request failed. Your task record may still be saved.");
      } finally {
        planButton.disabled = false;
      }
    }

    planButton.addEventListener("click", askJarvis);

    panel.querySelector("#jarvis-voice").addEventListener("click", () => {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        setStatus("Voice input isn't supported here. Please type instead.");
        return;
      }

      try {
        recognition = new SpeechRecognition();
        recognition.lang = "en-IN";
        recognition.interimResults = false;
        recognition.onresult = event => {
          input.value = event.results[0][0].transcript;
          setStatus("Voice captured. Review it and tap Ask JARVIS.");
        };
        recognition.onerror = () => setStatus("Voice input failed. Please type.");
        recognition.start();
        setStatus("Listening...");
      } catch {
        setStatus("Could not start voice input. Please type.");
      }
    });

    panel.querySelector("#jarvis-stop").addEventListener("click", () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      if (recognition) {
        try { recognition.stop(); } catch {}
      }
      setStatus("Speech stopped.");
    });

    list.addEventListener("click", async event => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const task = tasks.find(item => item.id === button.dataset.id);
      if (!task || task.status !== "Awaiting approval") return;

      const statusValue = button.dataset.action === "approve"
        ? "Approved for local use"
        : "Rejected";

      try {
        await updateTask(task, { status: statusValue });
        setStatus(statusValue === "Rejected"
          ? "Task rejected."
          : "Approved for your local use only. No external action was performed.");
      } catch {
        setStatus("Could not update task status. Please retry.");
      }
    });

    // Check whether a valid owner session already exists.
    api("/api/jarvis-tasks?action=list")
      .then(result => {
        tasks = Array.isArray(result.tasks) ? result.tasks : [];
        render();
        login.hidden = true;
        work.hidden = false;
        setStatus("JARVIS ready. Your saved tasks are loaded.");
      })
      .catch(() => {
        login.hidden = false;
        work.hidden = true;
        setStatus("Sign in to access private JARVIS task storage.");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

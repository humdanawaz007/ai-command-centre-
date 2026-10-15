/* JARVIS Core — AI Command Centre
   Safe first module: task planning, voice input,
   spoken replies, local task history and approvals.
   No publishing, messaging, purchases or real trades.
*/
(() => {
  "use strict";

  const STORAGE_KEY = "acc_jarvis_tasks_v1";
  const MAX_TASKS = 50;

  const styles = `
    #jarvis-panel {
      margin: 18px auto;
      padding: 18px;
      max-width: 960px;
      border: 1px solid #35c99a;
      border-radius: 18px;
      background: #101d2d;
      color: #edf3ff;
      font: 15px/1.5 system-ui, Arial, sans-serif;
    }
    #jarvis-panel * { box-sizing: border-box; }
    #jarvis-panel h2 { margin: 0 0 6px; font-size: 23px; }
    #jarvis-panel p { color: #a9b8cc; }
    #jarvis-panel textarea {
      width: 100%; min-height: 100px; resize: vertical;
      padding: 12px; border-radius: 10px;
      border: 1px solid #344761; background: #0b1422;
      color: #edf3ff; font: inherit;
    }
    #jarvis-panel button {
      padding: 10px 14px; margin: 5px 5px 5px 0;
      border: 1px solid #35c99a; border-radius: 9px;
      background: #16392f; color: #fff; font: inherit;
      cursor: pointer;
    }
    #jarvis-panel button:disabled { opacity: .5; cursor: wait; }
    #jarvis-status { margin: 12px 0; color: #78e3bd; }
    #jarvis-list { padding: 0; list-style: none; }
    #jarvis-list li {
      padding: 12px; margin: 8px 0; border-radius: 10px;
      background: #17263a; overflow-wrap: anywhere;
    }
    #jarvis-list small { display: block; color: #a9b8cc; }
    #jarvis-panel .jarvis-danger {
      border-color: #d69a65; background: #392719;
    }
  `;

  function readTasks() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveTasks(tasks) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(tasks.slice(0, MAX_TASKS))
      );
      return true;
    } catch {
      return false;
    }
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function start() {
    if (document.getElementById("jarvis-panel")) return;

    const style = document.createElement("style");
    style.textContent = styles;
    document.head.appendChild(style);

    const panel = document.createElement("section");
    panel.id = "jarvis-panel";
    panel.innerHTML = `
      <h2>JARVIS AI Assistant</h2>
      <p>Plan tasks, prepare requests and track approvals.</p>
      <textarea id="jarvis-input"
        aria-label="Your instruction"
        placeholder="Example: Prepare a video script about healthy habits."></textarea>
      <div>
        <button id="jarvis-plan">Ask JARVIS</button>
        <button id="jarvis-voice">🎙 Speak</button>
        <button id="jarvis-stop">Stop speaking</button>
      </div>
      <div id="jarvis-status" role="status" aria-live="polite">
        JARVIS ready. Waiting for your instruction.
      </div>
      <h3>Task history</h3>
      <ul id="jarvis-list"></ul>
      <button id="jarvis-clear" class="jarvis-danger">
        Clear task history
      </button>
    `;

    const host = document.querySelector("main") ||
                 document.querySelector("body");
    host.appendChild(panel);

    const input = panel.querySelector("#jarvis-input");
    const status = panel.querySelector("#jarvis-status");
    const list = panel.querySelector("#jarvis-list");
    const planButton = panel.querySelector("#jarvis-plan");

    let tasks = readTasks();
    let recognition = null;

    function setStatus(message) {
      status.textContent = message;
    }

    function render() {
      list.innerHTML = tasks.map(task => `
        <li>
          <strong>${escapeHTML(task.request)}</strong>
          <small>Status: ${escapeHTML(task.status)}</small>
          <small>${escapeHTML(task.created)}</small>
          ${task.reply
            ? `<p>${escapeHTML(task.reply)}</p>`
            : ""}
          ${task.status === "Awaiting approval"
            ? `<button data-approve="${escapeHTML(task.id)}">
                 Approve local task
               </button>`
            : ""}
          ${task.status === "Awaiting approval"
            ? `<button class="jarvis-danger"
                 data-reject="${escapeHTML(task.id)}">
                 Reject
               </button>`
            : ""}
        </li>
      `).join("") || "<li>No tasks yet.</li>";
    }

    function speak(message) {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = "en-IN";
      window.speechSynthesis.speak(utterance);
    }

    async function askJarvis() {
      const request = input.value.trim();
      if (!request) {
        setStatus("Please enter an instruction first.");
        return;
      }

      planButton.disabled = true;
      setStatus("JARVIS is preparing your response...");

      const task = {
        id: Date.now().toString(36) +
            Math.random().toString(36).slice(2, 7),
        request,
        status: "In progress",
        created: new Date().toLocaleString(),
        reply: ""
      };

      tasks.unshift(task);
      tasks = tasks.slice(0, MAX_TASKS);
      saveTasks(tasks);
      render();

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "chat",
            message:
              "You are JARVIS, the assistant for AI Command Centre. " +
              "Help plan safe, practical tasks for online business, " +
              "content creation and market analysis. Give clear steps. " +
              "Do not claim to have executed actions you have not done. " +
              "Never claim to send messages, publish content, spend " +
              "money or place trades. Ask for explicit human approval " +
              "before any external action. User request: " + request
          })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Server error " + response.status);
        }
        if (typeof data.reply !== "string" || !data.reply.trim()) {
          throw new Error("The server returned no assistant reply.");
        }

        task.reply = data.reply.trim();
        task.status = "Awaiting approval";
        setStatus("Response ready. Review it before taking action.");
        speak(task.reply);
      } catch (error) {
        task.status = "Failed";
        task.reply = error.message || "Request failed.";
        setStatus("JARVIS could not complete the request.");
      } finally {
        tasks = tasks.slice(0, MAX_TASKS);
        saveTasks(tasks);
        render();
        planButton.disabled = false;
      }
    }

    planButton.addEventListener("click", askJarvis);

    panel.querySelector("#jarvis-voice").addEventListener("click", () => {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        setStatus("Voice input is not supported in this browser. Please type.");
        return;
      }

      try {
        recognition = new SpeechRecognition();
        recognition.lang = "en-IN";
        recognition.interimResults = false;
        recognition.onresult = event => {
          input.value = event.results[0][0].transcript;
          setStatus("Voice captured. Review it, then tap Ask JARVIS.");
        };
        recognition.onerror = () => {
          setStatus("Voice input failed. You can type your instruction.");
        };
        recognition.start();
        setStatus("Listening...");
      } catch {
        setStatus("Could not start voice input. Please type instead.");
      }
    });

    panel.querySelector("#jarvis-stop").addEventListener("click", () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      if (recognition) {
        try { recognition.stop(); } catch {}
      }
      setStatus("Speech stopped.");
    });

    list.addEventListener("click", event => {
      const approveId = event.target.getAttribute("data-approve");
      const rejectId = event.target.getAttribute("data-reject");
      if (!approveId && !rejectId) return;

      const task = tasks.find(item =>
        item.id === (approveId || rejectId)
      );
      if (!task || task.status !== "Awaiting approval") return;

      if (approveId) {
        task.status = "Approved for local use";
        setStatus(
          "Approved for your review/use only. No external action was performed."
        );
      } else {
        task.status = "Rejected";
        setStatus("Task rejected.");
      }

      saveTasks(tasks);
      render();
    });

    panel.querySelector("#jarvis-clear").addEventListener("click", () => {
      if (!window.confirm("Clear all JARVIS task history on this browser?")) {
        return;
      }
      tasks = [];
      saveTasks(tasks);
      render();
      setStatus("Task history cleared on this browser.");
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
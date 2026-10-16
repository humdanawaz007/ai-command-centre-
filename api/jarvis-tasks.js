
"use strict";

const crypto = require("crypto");

const COOKIE_NAME = "jarvis_owner_session";
const PREFIX = "acc:jarvis:";
const INDEX_KEY = PREFIX + "task-index";
const MAX_TASKS = 50;
const MAX_REQUEST_LENGTH = 3000;

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}

function validId(value) {
  return typeof value === "string" &&
    /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

function validStatus(value) {
  return [
    "In progress",
    "Awaiting approval",
    "Approved for local use",
    "Rejected",
    "Failed"
  ].includes(value);
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;

    if (part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }

  return "";
}

function verifySession(req) {
  const secret = process.env.JARVIS_SESSION_SECRET;
  if (!secret || secret.length < 32) return false;

  const value = getCookie(req, COOKIE_NAME);
  const parts = value.split(".");
  if (parts.length !== 2) return false;

  const [payload, suppliedSignature] = parts;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  const a = Buffer.from(suppliedSignature);
  const b = Buffer.from(expectedSignature);

  if (a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)) {
    return false;
  }

  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    return data.owner === true &&
      Number.isInteger(data.exp) &&
      data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Redis configuration is missing.");
  }

  const response = await fetch(
    url.replace(/\/+$/, ""),
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    throw new Error("Redis command failed.");
  }

  return data.result;
}

function publicTask(task) {
  return {
    id: task.id,
    request: task.request,
    reply: task.reply || "",
    status: task.status,
    created: task.created,
    updated: task.updated || task.created
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Public read-only health check; never exposes credentials or task data.
  if (req.method === "GET" &&
      !(req.query && req.query.action)) {
    try {
      const result = await redis(["PING"]);

      return send(res, result === "PONG" ? 200 : 503, {
        service: "JARVIS Task Service",
        status: result === "PONG"
          ? "connected"
          : "connection_failed",
        persistentStorage: result === "PONG",
        ownerLoginRequired: true,
        scheduler: false,
        message: "Health check only; no task was created."
      });
    } catch {
      return send(res, 503, {
        service: "JARVIS Task Service",
        status: "connection_failed",
        persistentStorage: false
      });
    }
  }

  // Every task read/write requires a valid owner session.
  if (!verifySession(req)) {
    return send(res, 401, {
      error: "Please sign in to JARVIS."
    });
  }

  try {
    if (req.method === "GET" &&
        req.query &&
        req.query.action === "list") {
      const ids = await redis([
        "LRANGE", INDEX_KEY, "0", String(MAX_TASKS - 1)
      ]);

      const tasks = [];

      for (const id of Array.isArray(ids) ? ids : []) {
        if (!validId(id)) continue;

        const raw = await redis([
          "GET", PREFIX + "task:" + id
        ]);

        if (!raw) continue;

        try {
          const task = JSON.parse(raw);
          if (task && task.id === id) {
            tasks.push(publicTask(task));
          }
        } catch {
          // Ignore malformed task records.
        }
      }

      return send(res, 200, { tasks });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return send(res, 405, {
        error: "Method not allowed."
      });
    }

    const body = req.body || {};

    if (body.action === "create") {
      const request = typeof body.request === "string"
        ? body.request.trim()
        : "";

      if (!request || request.length > MAX_REQUEST_LENGTH) {
        return send(res, 400, {
          error: "Task request must be 1 to 3000 characters."
        });
      }

      const id = body.id;

      if (!validId(id)) {
        return send(res, 400, {
          error: "A valid task ID is required."
        });
      }

      const key = PREFIX + "task:" + id;
      const existing = await redis(["GET", key]);

      if (existing) {
        return send(res, 409, {
          error: "Task ID already exists."
        });
      }

      const now = new Date().toISOString();

      const task = {
        id,
        request,
        reply: "",
        status: "In progress",
        created: now,
        updated: now
      };

      await redis(["SET", key, JSON.stringify(task)]);
      await redis(["LPUSH", INDEX_KEY, id]);
      await redis([
        "LTRIM", INDEX_KEY, "0", String(MAX_TASKS - 1)
      ]);

      return send(res, 201, {
        task: publicTask(task)
      });
    }

    if (body.action === "update") {
      const id = body.id;

      if (!validId(id)) {
        return send(res, 400, {
          error: "Invalid task ID."
        });
      }

      const key = PREFIX + "task:" + id;
      const raw = await redis(["GET", key]);

      if (!raw) {
        return send(res, 404, {
          error: "Task not found."
        });
      }

      const task = JSON.parse(raw);

      if (typeof body.reply === "string") {
        if (body.reply.length > 12000) {
          return send(res, 400, {
            error: "Reply is too long."
          });
        }
        task.reply = body.reply;
      }

      if (body.status !== undefined) {
        if (!validStatus(body.status)) {
          return send(res, 400, {
            error: "Invalid task status."
          });
        }
        task.status = body.status;
      }

      task.updated = new Date().toISOString();
      await redis(["SET", key, JSON.stringify(task)]);

      return send(res, 200, {
        task: publicTask(task)
      });
    }

    if (body.action === "delete") {
      const id = body.id;

      if (!validId(id)) {
        return send(res, 400, {
          error: "Invalid task ID."
        });
      }

      await redis(["DEL", PREFIX + "task:" + id]);
      await redis(["LREM", INDEX_KEY, "0", id]);

      return send(res, 200, { deleted: true });
    }

    return send(res, 400, {
      error: "Supported actions: create, update, delete."
    });
  } catch {
    console.error("JARVIS task API operation failed.");

    return send(res, 503, {
      error: "Task storage is temporarily unavailable."
    });
  }
};

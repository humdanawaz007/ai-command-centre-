"use strict";

const crypto = require("crypto");

const PREFIX = "acc:jarvis:";
const INDEX_KEY = PREFIX + "task-index";
const MAX_TASKS = 50;

function send(res, status, body) {
  return res.status(status).json(body);
}

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Redis is not configured.");
  }

  const response = await fetch(url.replace(/\/+$/, ""), {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    throw new Error("Redis request failed.");
  }

  return data.result;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, {
      ok: false,
      error: "Method not allowed."
    });
  }

  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || "";
  const supplied = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : "";

  if (!secret) {
    return send(res, 503, {
      ok: false,
      error: "CRON_SECRET is not configured."
    });
  }

  const a = Buffer.from(supplied);
  const b = Buffer.from(secret);

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    return send(res, 401, {
      ok: false,
      error: "Unauthorized."
    });
  }

  const now = new Date();
  const indiaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);

  const taskId = "daily-halal-" + indiaDate;
  const taskKey = PREFIX + "task:" + taskId;
  const lockKey = PREFIX + "daily-lock:" + indiaDate;

  let lockAcquired = false;

  try {
    const existing = await redis(["GET", taskKey]);

    if (existing) {
      return send(res, 200, {
        ok: true,
        skipped: true,
        reason: "Today's draft already exists."
      });
    }

    const lock = await redis([
      "SET", lockKey, "running", "NX", "EX", "1800"
    ]);

    if (lock !== "OK") {
      return send(res, 200, {
        ok: true,
        skipped: true,
        reason: "Today's workflow is already running."
      });
    }

    lockAcquired = true;

    const host = "ai-command-centre-plum.vercel.app";

const aiResponse = await fetch(
  "https://" + host + "/api/chat",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },

    const aiResponse = await fetch(
      "https://" + host + "/api/chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "chat",
          message:
            "Create ONE original short-video content draft for a " +
            "halal-friendly educational channel. Topic area: mixed " +
            "halal topics, including beneficial Islamic reminders, " +
            "verified educational facts, ethical online earning, " +
            "and useful technology. Rotate topics rather than making " +
            "every draft religious. Avoid fabricated Quran or hadith " +
            "quotes, unsupported claims, gambling, interest-based " +
            "earning promotion, deceptive promises, and copyrighted " +
            "scripts. Return these exact headings: TOPIC, TITLE, HOOK, " +
            "VOICEOVER SCRIPT (about 30-45 seconds), VISUAL PLAN " +
            "(simple text-based scenes), CAPTION, CALL TO ACTION, " +
            "HASHTAGS, FACT-CHECK NOTES. Be concise and original. " +
            "This is a draft for human review, not publication."
        })
      }
    );

    const aiData = await aiResponse.json().catch(() => ({}));

    if (!aiResponse.ok || typeof aiData.reply !== "string" ||
        !aiData.reply.trim()) {
      throw new Error(
  "AI draft generation failed. HTTP " +
  aiResponse.status +
  ". " +
  String(aiData.error || aiData.message || "No reply returned").slice(0, 300)
);
    }

    const created = new Date().toISOString();
    const task = {
      id: taskId,
      request: "Daily mixed halal short-video draft — " + indiaDate,
      reply: aiData.reply.trim().slice(0, 12000),
      status: "Awaiting approval",
      created,
      updated: created
    };

    await redis([
      "SET", taskKey, JSON.stringify(task), "EX", "2592000"
    ]);
    await redis(["LPUSH", INDEX_KEY, taskId]);
    await redis(["LTRIM", INDEX_KEY, "0", String(MAX_TASKS - 1)]);

    return send(res, 200, {
      ok: true,
      saved: true,
      status: task.status,
      date: indiaDate,
      message: "Draft saved for review. Nothing was published."
    });
  } catch (error) {
    console.error("JARVIS daily workflow failed:", error.message);

    if (lockAcquired) {
      try {
        await redis(["DEL", lockKey]);
      } catch {}
    }

    return send(res, 500, {
      ok: false,
      error: "Daily draft workflow failed. Check Vercel logs."
    });
  }
};
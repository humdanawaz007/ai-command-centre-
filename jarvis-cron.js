"use strict";

module.exports = async function handler(req, res) {
res.setHeader("Cache-Control", "no-store");
res.setHeader("X-Content-Type-Options", "nosniff");

if (req.method !== "GET") {
res.setHeader("Allow", "GET");
return res.status(405).json({
ok: false,
error: "Method not allowed"
});
}

const secret = process.env.CRON_SECRET;

if (!secret) {
return res.status(503).json({
ok: false,
error: "Scheduler secret is not configured."
});
}

const auth = req.headers.authorization || "";
const supplied = auth.startsWith("Bearer ")
? auth.slice(7)
: "";

const crypto = require("crypto");
const a = Buffer.from(supplied);
const b = Buffer.from(secret);

if (
a.length !== b.length ||
!crypto.timingSafeEqual(a, b)
) {
return res.status(401).json({
ok: false,
error: "Unauthorized"
});
}

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!redisUrl || !redisToken) {
return res.status(503).json({
ok: false,
error: "Task storage is not configured."
});
}

try {
const response = await fetch(
redisUrl.replace(//+$/, ""),
{
method: "POST",
headers: {
Authorization: "Bearer " + redisToken,
"Content-Type": "application/json"
},
body: JSON.stringify(["PING"])
}
);

const data = await response.json().catch(() => ({}));

if (!response.ok || data.result !== "PONG") {
  throw new Error("Storage health check failed.");
}

return res.status(200).json({
  ok: true,
  service: "JARVIS Scheduler",
  storage: "connected",
  execution: "not_enabled",
  message:
    "Secure scheduler endpoint is responding. " +
    "No tasks were executed."
});

} catch {
return res.status(503).json({
ok: false,
error: "Task storage health check failed."
});
}
};
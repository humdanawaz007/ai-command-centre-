
"use strict";

const crypto = require("crypto");

const COOKIE_NAME = "jarvis_owner_session";
const SESSION_SECONDS = 60 * 60 * 12;

function sign(value, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(value)
    .digest("base64url");
}

function setCookie(res, value, maxAge) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
  );
}

function clearCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
  );
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  return (
    left.length === right.length &&
    crypto.timingSafeEqual(left, right)
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Use POST to log in or out."
    });
  }

  const password = process.env.JARVIS_OWNER_PASSWORD;
  const secret = process.env.JARVIS_SESSION_SECRET;

  if (!password || !secret || secret.length < 32) {
    return res.status(503).json({
      error: "Owner login is not configured."
    });
  }

  const action = req.body && req.body.action;

  if (action === "login") {
    const supplied =
      req.body && typeof req.body.password === "string"
        ? req.body.password
        : "";

    if (!safeEqual(supplied, password)) {
      return res.status(401).json({
        error: "Incorrect password."
      });
    }

    const expires =
      Math.floor(Date.now() / 1000) + SESSION_SECONDS;

    const payload = Buffer.from(
      JSON.stringify({ owner: true, exp: expires })
    ).toString("base64url");

    const signature = sign(payload, secret);

    setCookie(
      res,
      `${payload}.${signature}`,
      SESSION_SECONDS
    );

    return res.status(200).json({
      ok: true,
      expiresIn: SESSION_SECONDS
    });
  }

  if (action === "logout") {
    clearCookie(res);

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({
    error: "Supported actions: login, logout."
  });
};

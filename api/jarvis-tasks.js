module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Method not allowed. Read-only health check."
    });
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return res.status(503).json({
      status: "setup_required",
      message: "Redis environment variables are missing."
    });
  }

  try {
    const response = await fetch(url.replace(/\/+$/, "") + "/ping", {
      method: "GET",
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!response.ok) {
      return res.status(503).json({
        status: "connection_failed",
        message: "Redis connection check failed."
      });
    }

    const result = await response.json();

    if (result.result !== "PONG") {
      return res.status(503).json({
        status: "connection_failed",
        message: "Redis did not return PONG."
      });
    }

    return res.status(200).json({
      service: "JARVIS Task Service",
      status: "connected",
      persistentStorage: true,
      scheduler: false,
      message: "Redis connection verified. No tasks were created."
    });
  } catch (error) {
    console.error("JARVIS Redis health check failed.");
    return res.status(503).json({
      status: "connection_failed",
      message: "Could not reach Redis. Check configuration."
    });
  }
};
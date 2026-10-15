module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Method not allowed. This endpoint is read-only."
    });
  }

  return res.status(200).json({
    service: "JARVIS Task Service",
    status: "setup_required",
    persistentStorage: false,
    scheduler: false,
    message:
      "JARVIS task storage and scheduling are not configured yet. " +
      "No background tasks have been created or executed."
  });
};
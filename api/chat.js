module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing in Vercel Environment Variables."
    });
  }

  try {
    const {
      action = "chat",
      message,
      text,
      prompt,
      symbol
    } = req.body || {};

    // Current Gemini Interactions API.
    
async function interact(model, input, options = {}) {
  let response;
  let raw;

  try {
    response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify({
          model,
          input,
          ...options
        }),
        signal: AbortSignal.timeout(18000)
      }
    );

    raw = await response.text();
  } catch (error) {
    if (
      error.name === "TimeoutError" ||
      error.name === "AbortError"
    ) {
      throw new Error(
        "Google AI timed out after 18 seconds. Please try again."
      );
    }

    throw new Error(
      "Could not connect to Google AI: " +
      (error.message || "Network error.")
    );
  }

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "Google AI returned a non-JSON response (HTTP " +
      response.status + ")."
    );
  }

  if (!response.ok) {
    throw new Error(
      data.error?.message ||
      data.message ||
      "Google AI request failed (HTTP " +
      response.status + ")."
    );
  }

  return data;
}

      );

      const raw = await response.text();
      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(
          "Google AI returned a non-JSON response (HTTP " +
          response.status + ")."
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error?.message ||
          data.message ||
          "Google AI request failed (HTTP " + response.status + ")."
        );
      }

      return data;
    }

    // Collect output blocks from Interactions API responses.
    function collectBlocks(value, result = [], depth = 0) {
      if (!value || typeof value !== "object" || depth > 12) {
        return result;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          collectBlocks(item, result, depth + 1);
        }
        return result;
      }

      if (typeof value.data === "string" &&
          (value.type === "image" ||
           value.type === "audio" ||
           value.mime_type ||
           value.mimeType)) {
        result.push(value);
      }

      for (const [name, child] of Object.entries(value)) {
        if (name === "data" || name === "output_text") continue;
        if (child && typeof child === "object") {
          collectBlocks(child, result, depth + 1);
        }
      }

      return result;
    }

    function collectText(value, result = [], depth = 0) {
      if (!value || typeof value !== "object" || depth > 12) {
        return result;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          collectText(item, result, depth + 1);
        }
        return result;
      }

      if (value.type === "text" && typeof value.text === "string") {
        result.push(value.text);
      }

      for (const [name, child] of Object.entries(value)) {
        if (name === "data" || name === "output_text") continue;
        if (child && typeof child === "object") {
          collectText(child, result, depth + 1);
        }
      }

      return result;
    }

        // 1. AI chat and content generation, with fallback.
    if (action === "chat") {
      if (!message || !String(message).trim()) {
        return res.status(400).json({
          error: "Message is required."
        });
      }

      let data;
      let lastError;

      for (const model of [
        "gemini-3.8-flash",
        "gemini-3.5-flash-lite"
      ]) {
        try {
          data = await interact(
            model,
            String(message).trim(),
            { store: false }
          );
          break;
        } catch (error) {
          lastError = error;
          const msg = String(error.message || "").toLowerCase();

          const temporary =
            msg.includes("high demand") ||
            msg.includes("overloaded") ||
            msg.includes("unavailable") ||
            msg.includes("429") ||
            msg.includes("500") ||
            msg.includes("503") ||
            msg.includes("temporarily");

          if (!temporary || model === "gemini-3.5-flash-lite") {
            throw error;
          }
        }
      }

      if (!data) throw lastError || new Error("AI request failed.");

      const reply = (
        data.output_text ||
        collectText(data.steps || data.output || data).join("\n")
      ).trim();

      if (!reply) {
        throw new Error("The AI returned no text. Please try again.");
      }

      return res.status(200).json({ reply });
    }

    
    // 2. Image generation paused to avoid paid API usage.
    if (action === "generate_image") {
      return res.status(503).json({
        error: "AI scene-image generation is temporarily paused to avoid paid API usage. Use Prepare Scenes and Render & Download for text-based videos."
      });
    }

        // 3. AI voiceover with fallback.
    if (action === "tts") {
      if (!text || !String(text).trim()) {
        return res.status(400).json({
          error: "Text is required for voiceover."
        });
      }

      let data;
      let lastError;

      for (const model of [
        "gemini-3.8-flash-tts",
        "gemini-3.8-flash-lite-tts"
      ]) {
        try {
          data = await interact(
            model,
            String(text).trim().slice(0, 8000),
            {
              store: false,
              response_format: { type: "audio" },
              generation_config: {
                speech_config: [{ voice: "Kore" }]
              }
            }
          );
          break;
        } catch (error) {
          lastError = error;
          const msg = String(error.message || "").toLowerCase();
          const temporary =
            msg.includes("high demand") ||
            msg.includes("overloaded") ||
            msg.includes("unavailable") ||
            msg.includes("429") ||
            msg.includes("500") ||
            msg.includes("503") ||
            msg.includes("temporarily");

          if (!temporary || model === "gemini-3.8-flash-lite-tts") {
            throw error;
          }
        }
      }

      if (!data) throw lastError || new Error("Voiceover failed.");

      const audioBlock =
        data.output_audio ||
        collectBlocks(data.steps || data.output || data).find(block => {
          const mime = block.mime_type || block.mimeType || "";
          return block.type === "audio" || mime.startsWith("audio/");
        });

      if (!audioBlock?.data) {
        throw new Error("The voice model returned no audio.");
      }

      return res.status(200).json({
        audio: audioBlock.data,
        mimeType: audioBlock.mime_type ||
          audioBlock.mimeType ||
          "audio/wav"
      });
    }

    // 4. Market data. No live-trading connection.
    if (action === "market_data") {
      if (!symbol) {
        return res.status(400).json({
          error: "Symbol is required."
        });
      }

      const symbols = {
        NIFTY: "^NSEI",
        SENSEX: "^BSESN",
        RELIANCE: "RELIANCE.NS",
        TCS: "TCS.NS",
        INFY: "INFY.NS",
        HDFCBANK: "HDFCBANK.NS",
        ICICIBANK: "ICICIBANK.NS",
        SBIN: "SBIN.NS"
      };

      const ticker = symbols[symbol] || symbol;

      if (!/^[A-Za-z0-9.^=-]{1,30}$/.test(ticker)) {
        return res.status(400).json({
          error: "Invalid market symbol."
        });
      }

      const url =
        "https://query1.finance.yahoo.com/v8/finance/chart/" +
        encodeURIComponent(ticker) +
        "?range=5d&interval=1d";

      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" }
      });

      const raw = await response.text();
      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error("Market provider returned invalid data.");
      }

      const result = data.chart?.result?.[0];

      if (!response.ok || !result) {
        throw new Error(
          data.chart?.error?.description ||
          "Market data is unavailable for " + ticker + "."
        );
      }

      const meta = result.meta || {};
      const quotes = result.indicators?.quote?.[0] || {};
      const closes = (quotes.close || []).filter(Number.isFinite);
      const latest = meta.regularMarketPrice ?? closes.at(-1);

      if (!Number.isFinite(latest)) {
        throw new Error("No recent price was returned for this symbol.");
      }

      const previous =
        meta.chartPreviousClose ??
        meta.previousClose ??
        closes.at(-2) ??
        latest;

      return res.status(200).json({
        symbol,
        ticker,
        currency: meta.currency || "Unknown",
        price: latest,
        previousClose: previous,
        change: latest - previous,
        changePercent: previous
          ? ((latest - previous) / previous) * 100
          : 0,
        marketTime: meta.regularMarketTime || null,
        source: "Yahoo Finance",
        delayed: true
      });
    }

    // 5. Simulation only. Never sends a real order.
    if (action === "paper_trade") {
      const {
        side,
        quantity,
        price: tradePrice
      } = req.body || {};

      if (!["BUY", "SELL"].includes(side)) {
        return res.status(400).json({
          error: "Side must be BUY or SELL."
        });
      }

      if (
        !Number.isInteger(Number(quantity)) ||
        Number(quantity) < 1
      ) {
        return res.status(400).json({
          error: "Quantity must be a positive whole number."
        });
      }

      if (
        !Number.isFinite(Number(tradePrice)) ||
        Number(tradePrice) <= 0
      ) {
        return res.status(400).json({
          error: "Price must be greater than zero."
        });
      }

      return res.status(200).json({
        success: true,
        simulated: true,
        symbol: symbol || "UNKNOWN",
        side,
        quantity: Number(quantity),
        price: Number(tradePrice),
        total: Number(quantity) * Number(tradePrice),
        message: "Simulation only. No real order was placed."
      });
    }

    return res.status(400).json({
      error: "Unsupported action: " + action
    });
  } catch (error) {
    console.error("AI Command Centre API error:", error);

    return res.status(500).json({
      error: error.message || "The server request failed."
    });
  }
};
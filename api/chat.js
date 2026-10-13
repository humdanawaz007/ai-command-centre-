module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "GEMINI_API_KEY is missing in Vercel Environment Variables." });
  }

  try {
    const { action = "chat", message, text, prompt, symbol } = req.body || {};

    async function gemini(model, body) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || `Gemini API error ${response.status}`);
      }

      return data;
    }

    if (action === "chat") {
      if (!message || !String(message).trim()) {
        return res.status(400).json({ error: "Message is required." });
      }

      const data = await gemini("gemini-2.5-flash", {
        contents: [{
          role: "user",
          parts: [{ text: String(message) }]
        }]
      });

      const reply = data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

      if (!reply) throw new Error("The AI returned no text.");
      return res.status(200).json({ reply });
    }

    if (action === "generate_image") {
      if (!prompt || !String(prompt).trim()) {
        return res.status(400).json({ error: "Image prompt is required." });
      }

      const data = await gemini("gemini-2.5-flash-image", {
        contents: [{
          role: "user",
          parts: [{
            text: String(prompt) +
              " Create one high-quality vertical 9:16 cinematic image. No written text or logos."
          }]
        }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"]
        }
      });

      const parts = data.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find(part => part.inlineData?.data);

      if (!imagePart) {
        throw new Error(
          parts.map(part => part.text || "").filter(Boolean).join(" ") ||
          "The image model returned no image. Check model availability for your API key."
        );
      }

      return res.status(200).json({
        image: imagePart.inlineData.data,
        mimeType: imagePart.inlineData.mimeType || "image/png"
      });
    }

    if (action === "tts") {
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: "Text is required for voiceover." });
      }

      const data = await gemini("gemini-2.5-flash-preview-tts", {
        contents: [{
          parts: [{
            text: "Read this script naturally and clearly for a short video: " +
              String(text).slice(0, 8000)
          }]
        }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" }
            }
          }
        }
      });

      const parts = data.candidates?.[0]?.content?.parts || [];
      const audioPart = parts.find(part => part.inlineData?.data);

      if (!audioPart) throw new Error("The voice model returned no audio.");

      const pcm = Buffer.from(audioPart.inlineData.data, "base64");
      const sampleRate = 24000;
      const channels = 1;
      const bitsPerSample = 16;
      const byteRate = sampleRate * channels * bitsPerSample / 8;
      const wav = Buffer.alloc(44 + pcm.length);

      wav.write("RIFF", 0);
      wav.writeUInt32LE(36 + pcm.length, 4);
      wav.write("WAVE", 8);
      wav.write("fmt ", 12);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(channels, 22);
      wav.writeUInt32LE(sampleRate, 24);
      wav.writeUInt32LE(byteRate, 28);
      wav.writeUInt16LE(channels * bitsPerSample / 8, 32);
      wav.writeUInt16LE(bitsPerSample, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(pcm.length, 40);
      pcm.copy(wav, 44);

      return res.status(200).json({
        audio: wav.toString("base64"),
        mimeType: "audio/wav"
      });
    }

    if (action === "market_data") {
      if (!symbol) return res.status(400).json({ error: "Symbol is required." });

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
        return res.status(400).json({ error: "Invalid market symbol." });
      }

      const url =
        "https://query1.finance.yahoo.com/v8/finance/chart/" +
        encodeURIComponent(ticker) + "?range=5d&interval=1d";

      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      const data = await response.json();
      const result = data.chart?.result?.[0];

      if (!response.ok || !result) {
        throw new Error(data.chart?.error?.description || "Market data is unavailable.");
      }

      const meta = result.meta || {};
      const quotes = result.indicators?.quote?.[0] || {};
      const closes = (quotes.close || []).filter(Number.isFinite);
      const latest = meta.regularMarketPrice ?? closes.at(-1);

      if (!Number.isFinite(latest)) {
        throw new Error("No recent price was returned for this symbol.");
      }

      const previous = meta.chartPreviousClose ??
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
        changePercent: previous ? ((latest - previous) / previous) * 100 : 0,
        marketTime: meta.regularMarketTime || null,
        source: "Yahoo Finance",
        delayed: true
      });
    }

    if (action === "paper_trade") {
      const { side, quantity, price: tradePrice } = req.body || {};

      if (!["BUY", "SELL"].includes(side)) {
        return res.status(400).json({ error: "Side must be BUY or SELL." });
      }

      if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1) {
        return res.status(400).json({ error: "Quantity must be a positive whole number." });
      }

      if (!Number.isFinite(Number(tradePrice)) || Number(tradePrice) <= 0) {
        return res.status(400).json({ error: "Price must be greater than zero." });
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

    return res.status(400).json({ error: "Unsupported action: " + action });
  } catch (error) {
    console.error("AI Command Centre API error:", error);
    return res.status(500).json({
      error: error.message || "The server request failed."
    });
  }
};
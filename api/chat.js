
module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const action = req.body?.action || "chat";

    // =====================================================
    // MARKET DATA — Yahoo Finance
    // =====================================================

    if (action === "market_data") {
      const symbol = String(req.body?.symbol || "NIFTY")
        .trim()
        .toUpperCase();

      const symbolMap = {
        NIFTY: "^NSEI",
        SENSEX: "^BSESN",
        RELIANCE: "RELIANCE.NS",
        TCS: "TCS.NS",
        INFY: "INFY.NS",
        HDFCBANK: "HDFCBANK.NS",
        ICICIBANK: "ICICIBANK.NS",
        SBIN: "SBIN.NS"
      };

      const yahooSymbol = symbolMap[symbol];

      if (!yahooSymbol) {
        return res.status(400).json({
          success: false,
          error: "Unsupported market symbol",
          supportedSymbols: Object.keys(symbolMap)
        });
      }

      let marketData = null;
      let lastError = "Market data unavailable";

      for (const host of [
        "query1.finance.yahoo.com",
        "query2.finance.yahoo.com"
      ]) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        try {
          const url =
            "https://" + host +
            "/v8/finance/chart/" +
            encodeURIComponent(yahooSymbol) +
            "?range=1d&interval=5m";

          const response = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0"
            },
            signal: controller.signal
          });

          clearTimeout(timeout);

          if (!response.ok) {
            lastError = "Yahoo Finance HTTP " + response.status;
            continue;
          }

          const json = await response.json();

          if (json?.chart?.result?.[0]) {
            marketData = json.chart.result[0];
            break;
          }

          lastError = "No market data returned";
        } catch (error) {
          clearTimeout(timeout);
          lastError = error?.name === "AbortError"
            ? "Market data request timed out"
            : "Unable to connect to Yahoo Finance";
        }
      }

      if (!marketData) {
        return res.status(502).json({
          success: false,
          error: lastError,
          symbol
        });
      }

      const meta = marketData.meta || {};
      const timestamps = marketData.timestamp || [];
      const quote = marketData.indicators?.quote?.[0] || {};
      const closes = quote.close || [];
      const opens = quote.open || [];
      const highs = quote.high || [];
      const lows = quote.low || [];
      const volumes = quote.volume || [];

      let latestIndex = -1;

      for (let i = closes.length - 1; i >= 0; i--) {
        if (
          typeof closes[i] === "number" &&
          Number.isFinite(closes[i]) &&
          closes[i] > 0
        ) {
          latestIndex = i;
          break;
        }
      }

      let price = latestIndex >= 0
        ? Number(closes[latestIndex])
        : Number(meta.regularMarketPrice);

      if (!Number.isFinite(price) || price <= 0) {
        price = Number(meta.regularMarketPrice);
      }

      if (!Number.isFinite(price) || price <= 0) {
        return res.status(502).json({
          success: false,
          error: "No valid market price returned",
          symbol
        });
      }

      let previousClose = Number(
        meta.previousClose ?? meta.chartPreviousClose
      );

      if (!Number.isFinite(previousClose) || previousClose <= 0) {
        previousClose = price;
      }

      const candles = [];

      for (
        let i = Math.max(0, closes.length - 100);
        i < closes.length;
        i++
      ) {
        if (
          typeof closes[i] !== "number" ||
          !Number.isFinite(closes[i])
        ) {
          continue;
        }

        candles.push({
          timestamp: timestamps[i] ?? null,
          open: opens[i] ?? null,
          high: highs[i] ?? null,
          low: lows[i] ?? null,
          close: closes[i],
          volume: volumes[i] ?? null
        });
      }

      return res.status(200).json({
        success: true,
        symbol,
        yahooSymbol,
        currency: meta.currency || "INR",
        exchange: meta.exchangeName || meta.fullExchangeName || "N/A",
        marketState: meta.marketState || "UNKNOWN",
        price,
        currentPrice: price,
        previousClose,
        change: price - previousClose,
        changePercent: previousClose
          ? ((price - previousClose) / previousClose) * 100
          : 0,
        open: latestIndex >= 0 ? opens[latestIndex] ?? null : null,
        high: latestIndex >= 0 ? highs[latestIndex] ?? null : null,
        low: latestIndex >= 0 ? lows[latestIndex] ?? null : null,
        volume: latestIndex >= 0 ? volumes[latestIndex] ?? null : null,
        timestamp: latestIndex >= 0
          ? timestamps[latestIndex] ?? null
          : Math.floor(Date.now() / 1000),
        candles,
        dataSource: "Yahoo Finance",
        paperTradingOnly: true,
        fetchedAt: new Date().toISOString()
      });
    }

    // =====================================================
    // PAPER TRADING — SIMULATED ONLY, NO REAL ORDERS
    // =====================================================

    if (action === "paper_trade") {
      const symbol = String(req.body?.symbol || "")
        .trim()
        .toUpperCase();

      const side = String(req.body?.side || "")
        .trim()
        .toUpperCase();

      const quantity = Number(req.body?.quantity);
      const price = Number(req.body?.price);

      if (!symbol) {
        return res.status(400).json({
          success: false,
          error: "Symbol is required"
        });
      }

      if (side !== "BUY" && side !== "SELL") {
        return res.status(400).json({
          success: false,
          error: "Side must be BUY or SELL"
        });
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({
          success: false,
          error: "Quantity must be greater than zero"
        });
      }

      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({
          success: false,
          error: "Price must be greater than zero"
        });
      }

      return res.status(200).json({
        success: true,
        paperTrade: true,
        realTradeExecuted: false,
        order: {
          orderId: "PAPER-" + Date.now(),
          symbol,
          side,
          quantity,
          price,
          value: quantity * price,
          status: "SIMULATED",
          createdAt: new Date().toISOString()
        },
        message: "Simulated trade only. No real order was placed."
      });
    }

    // =====================================================
    // OPTIONAL OPENAI TEXT-TO-SPEECH ENDPOINT
    // The browser voiceover does not require this endpoint.
    // =====================================================

    if (action === "tts") {
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        return res.status(503).json({
          success: false,
          error: "OpenAI voice is unavailable. Use browser voiceover instead."
        });
      }

      const text = String(req.body?.text || "").trim();

      if (!text) {
        return res.status(400).json({
          success: false,
          error: "Text is required for voice generation"
        });
      }

      if (text.length > 4096) {
        return res.status(400).json({
          success: false,
          error: "Text is too long for one voice request"
        });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      let response;

      try {
        response = await fetch(
          "https://api.openai.com/v1/audio/speech",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + apiKey
            },
            body: JSON.stringify({
              model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
              voice: process.env.OPENAI_TTS_VOICE || "alloy",
              input: text,
              response_format: "mp3"
            }),
            signal: controller.signal
          }
        );
      } catch (error) {
        clearTimeout(timeout);

        return res.status(
          error?.name === "AbortError" ? 504 : 502
        ).json({
          success: false,
          error: error?.name === "AbortError"
            ? "Voice generation timed out"
            : "Unable to connect to OpenAI voice service"
        });
      }

      clearTimeout(timeout);

      if (!response.ok) {
        let errorData = {};

        try {
          errorData = await response.json();
        } catch (_) {}

        return res.status(response.status).json({
          success: false,
          error: errorData?.error?.message ||
            "OpenAI voice generation failed"
        });
      }

      const audioBuffer = Buffer.from(
        await response.arrayBuffer()
      );

      return res.status(200).json({
        success: true,
        audio: audioBuffer.toString("base64"),
        mimeType: "audio/mpeg",
        model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
        voice: process.env.OPENAI_TTS_VOICE || "alloy"
      });
    }

    // =====================================================
    // NORMAL AI CHAT — GOOGLE GEMINI
    // =====================================================

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "GEMINI_API_KEY is missing in Vercel"
      });
    }

    const message = typeof req.body?.message === "string"
      ? req.body.message.trim()
      : "";

    const conversation = Array.isArray(req.body?.conversation)
      ? req.body.conversation
      : [];

    if (!message && conversation.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Message is required"
      });
    }

    let contents = conversation
      .filter((item) =>
        item &&
        typeof item.role === "string" &&
        typeof item.content === "string" &&
        item.content.trim()
      )
      .map((item) => ({
        role: item.role === "assistant" || item.role === "model"
          ? "model"
          : "user",
        parts: [{ text: item.content.trim() }]
      }));

    if (contents.length === 0 && message) {
      contents = [{
        role: "user",
        parts: [{ text: message }]
      }];
    }

    contents = contents.slice(-30);

    // Gemini conversations must start with a user message.
    while (contents.length && contents[0].role !== "user") {
      contents.shift();
    }

    // Gemini does not accept consecutive messages with the same role.
    const normalizedContents = [];

    for (const item of contents) {
      const previous = normalizedContents[
        normalizedContents.length - 1
      ];

      if (previous && previous.role === item.role) {
        previous.parts[0].text += "\n\n" + item.parts[0].text;
      } else {
        normalizedContents.push({
          role: item.role,
          parts: [{ text: item.parts[0].text }]
        });
      }
    }

    if (!normalizedContents.length) {
      return res.status(400).json({
        success: false,
        error: "Please send a new message"
      });
    }

    const model = "gemini-2.5-flash";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    let response;

    try {
      response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" +
          model +
          ":generateContent?key=" +
          encodeURIComponent(apiKey),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text:
                  "You are the AI Command Centre assistant. Help users create useful, accurate and practical content. For social media, provide ready-to-use titles, hooks, scripts, captions, calls to action and hashtags when relevant. For trading or investments, provide educational information only. Never claim to place real trades. Be clear about uncertainty."
              }]
            },
            contents: normalizedContents,
            generationConfig: {
              maxOutputTokens: 2000,
              temperature: 0.7
            }
          }),
          signal: controller.signal
        }
      );
    } catch (error) {
      clearTimeout(timeout);

      return res.status(
        error?.name === "AbortError" ? 504 : 502
      ).json({
        success: false,
        error: error?.name === "AbortError"
          ? "Gemini request timed out. Please try again."
          : "Unable to connect to Gemini"
      });
    }

    clearTimeout(timeout);

    let data;

    try {
      data = await response.json();
    } catch (_) {
      return res.status(502).json({
        success: false,
        error: "Gemini returned invalid JSON"
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data?.error?.message || "Gemini request failed"
      });
    }

    const reply = (
      data?.candidates?.[0]?.content?.parts || []
    )
      .map((part) =>
        typeof part?.text === "string" ? part.text : ""
      )
      .join("\n")
      .trim();

    if (!reply) {
      const reason = data?.promptFeedback?.blockReason;

      return res.status(502).json({
        success: false,
        error: reason
          ? "Gemini could not answer this prompt: " + reason
          : "Gemini returned no text. Please try again."
      });
    }

    return res.status(200).json({
      success: true,
      reply,
      model
    });

  } catch (error) {
    console.error("AI Command Centre API Error:", error);

    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
};

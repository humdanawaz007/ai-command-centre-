module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const action = req.body?.action || "chat";

    /*
     * =====================================================
     * MARKET DATA
     * =====================================================
     */

    if (action === "market_data") {
      const requestedSymbol = String(
        req.body?.symbol || "NIFTY"
      )
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

      const yahooSymbol = symbolMap[requestedSymbol];

      if (!yahooSymbol) {
        return res.status(400).json({
          success: false,
          error: "Unsupported market symbol",
          supportedSymbols: Object.keys(symbolMap)
        });
      }

      /*
       * Try Yahoo Finance endpoints.
       * We use two hosts so a temporary problem with one
       * Yahoo endpoint does not automatically break the
       * trading dashboard.
       */

      const yahooUrls = [
        "https://query1.finance.yahoo.com/v8/finance/chart/" +
          encodeURIComponent(yahooSymbol) +
          "?range=1d&interval=5m",

        "https://query2.finance.yahoo.com/v8/finance/chart/" +
          encodeURIComponent(yahooSymbol) +
          "?range=1d&interval=5m"
      ];

      let data = null;
      let lastError = null;

      for (const yahooUrl of yahooUrls) {
        const controller = new AbortController();

        const timeout = setTimeout(() => {
          controller.abort();
        }, 15000);

        try {
          const response = await fetch(yahooUrl, {
            method: "GET",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            signal: controller.signal
          });

          clearTimeout(timeout);

          if (!response.ok) {
            lastError =
              "Yahoo Finance returned HTTP " +
              response.status;
            continue;
          }

          const json = await response.json();

          if (json?.chart?.result?.[0]) {
            data = json;
            break;
          }

          lastError = "Yahoo Finance returned no data.";
        } catch (error) {
          clearTimeout(timeout);

          lastError =
            error?.name === "AbortError"
              ? "Market data request timed out."
              : error?.message ||
                "Unable to connect to Yahoo Finance.";
        }
      }

      if (!data) {
        return res.status(502).json({
          success: false,
          error:
            lastError ||
            "Unable to retrieve market data right now.",
          symbol: requestedSymbol
        });
      }

      const result =
        data?.chart?.result?.[0];

      const meta =
        result?.meta || {};

      const timestamps =
        result?.timestamp || [];

      const quote =
        result?.indicators?.quote?.[0] || {};

      const opens =
        quote.open || [];

      const highs =
        quote.high || [];

      const lows =
        quote.low || [];

      const closes =
        quote.close || [];

      const volumes =
        quote.volume || [];

      /*
       * Find latest valid closing price.
       */

      let latestIndex = -1;

      for (
        let i = closes.length - 1;
        i >= 0;
        i--
      ) {
        if (
          typeof closes[i] === "number" &&
          Number.isFinite(closes[i]) &&
          closes[i] > 0
        ) {
          latestIndex = i;
          break;
        }
      }

      /*
       * Fallback to Yahoo regularMarketPrice if the
       * intraday candle array is unavailable.
       */

      let price = null;

      if (latestIndex >= 0) {
        price = Number(
          closes[latestIndex]
        );
      }

      if (
        !Number.isFinite(price) ||
        price <= 0
      ) {
        const regularMarketPrice =
          Number(
            meta.regularMarketPrice
          );

        if (
          Number.isFinite(
            regularMarketPrice
          ) &&
          regularMarketPrice > 0
        ) {
          price =
            regularMarketPrice;
        }
      }

      if (
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return res.status(502).json({
          success: false,
          error:
            "Yahoo Finance returned no valid price.",
          symbol: requestedSymbol
        });
      }

      /*
       * Previous close
       */

      let previousClose =
        Number(
          meta.previousClose
        );

      if (
        !Number.isFinite(previousClose) ||
        previousClose <= 0
      ) {
        previousClose =
          Number(
            meta.chartPreviousClose
          );
      }

      if (
        !Number.isFinite(previousClose) ||
        previousClose <= 0
      ) {
        previousClose = price;
      }

      const change =
        price - previousClose;

      const changePercent =
        previousClose !== 0
          ? (change / previousClose) * 100
          : 0;

      /*
       * Build recent candles.
       */

      const candles = [];

      if (latestIndex >= 0) {
        const start =
          Math.max(
            0,
            closes.length - 100
          );

        for (
          let i = start;
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
            timestamp:
              typeof timestamps[i] ===
              "number"
                ? timestamps[i]
                : null,

            open:
              typeof opens[i] ===
              "number"
                ? opens[i]
                : null,

            high:
              typeof highs[i] ===
              "number"
                ? highs[i]
                : null,

            low:
              typeof lows[i] ===
              "number"
                ? lows[i]
                : null,

            close:
              Number(closes[i]),

            volume:
              typeof volumes[i] ===
              "number"
                ? volumes[i]
                : null
          });
        }
      }

      return res.status(200).json({
        success: true,

        symbol:
          requestedSymbol,

        yahooSymbol:
          yahooSymbol,

        currency:
          meta.currency || "INR",

        exchange:
          meta.exchangeName ||
          meta.fullExchangeName ||
          "N/A",

        marketState:
          meta.marketState ||
          "UNKNOWN",

        price:
          Number(price),

        currentPrice:
          Number(price),

        previousClose:
          Number(previousClose),

        change:
          Number(change),

        changePercent:
          Number(changePercent),

        open:
          latestIndex >= 0 &&
          typeof opens[latestIndex] ===
            "number"
            ? opens[latestIndex]
            : null,

        high:
          latestIndex >= 0 &&
          typeof highs[latestIndex] ===
            "number"
            ? highs[latestIndex]
            : null,

        low:
          latestIndex >= 0 &&
          typeof lows[latestIndex] ===
            "number"
            ? lows[latestIndex]
            : null,

        volume:
          latestIndex >= 0 &&
          typeof volumes[latestIndex] ===
            "number"
            ? volumes[latestIndex]
            : null,

        timestamp:
          latestIndex >= 0 &&
          typeof timestamps[latestIndex] ===
            "number"
            ? timestamps[latestIndex]
            : Math.floor(
                Date.now() / 1000
              ),

        candles:
          candles,

        dataSource:
          "Yahoo Finance",

        paperTradingOnly:
          true,

        fetchedAt:
          new Date().toISOString()
      });
    }

    /*
     * =====================================================
     * PAPER TRADING
     * =====================================================
     */

    if (action === "paper_trade") {
      const symbol = String(
        req.body?.symbol || ""
      )
        .trim()
        .toUpperCase();

      const side = String(
        req.body?.side || ""
      )
        .trim()
        .toUpperCase();

      const quantity =
        Number(req.body?.quantity);

      const price =
        Number(req.body?.price);

      if (!symbol) {
        return res.status(400).json({
          success: false,
          error: "Symbol is required"
        });
      }

      if (
        side !== "BUY" &&
        side !== "SELL"
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Side must be BUY or SELL"
        });
      }

      if (
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Quantity must be greater than zero"
        });
      }

      if (
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Price must be greater than zero"
        });
      }

      const orderValue =
        quantity * price;

      const orderId =
        "PAPER-" +
        Date.now() +
        "-" +
        Math.random()
          .toString(36)
          .slice(2, 8)
          .toUpperCase();

      return res.status(200).json({
        success: true,

        paperTrade: true,

        realTradeExecuted:
          false,

        order: {
          orderId:
            orderId,

          symbol:
            symbol,

          side:
            side,

          quantity:
            quantity,

          price:
            price,

          value:
            orderValue,

          status:
            "SIMULATED",

          createdAt:
            new Date().toISOString()
        },

        message:
          "Paper trade simulated successfully. No real order was placed."
      });
    }

    /*
     * =====================================================
     * TEXT TO SPEECH
     * =====================================================
     */

    if (action === "tts") {
      const apiKey =
        process.env.OPENAI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({
          success: false,
          error:
            "OPENAI_API_KEY is missing in Vercel"
        });
      }

      const text =
        String(
          req.body?.text || ""
        ).trim();

      if (!text) {
        return res.status(400).json({
          success: false,
          error:
            "Text is required for voice generation"
        });
      }

      if (text.length > 4096) {
        return res.status(400).json({
          success: false,
          error:
            "Text is too long for one voice request"
        });
      }

      const ttsModel =
        process.env.OPENAI_TTS_MODEL ||
        "gpt-4o-mini-tts";

      const ttsVoice =
        process.env.OPENAI_TTS_VOICE ||
        "alloy";

      const controller =
        new AbortController();

      const timeout =
        setTimeout(() => {
          controller.abort();
        }, 60000);

      let response;

      try {
        response =
          await fetch(
            "https://api.openai.com/v1/audio/speech",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",

                "Authorization":
                  "Bearer " + apiKey
              },

              body: JSON.stringify({
                model:
                  ttsModel,

                voice:
                  ttsVoice,

                input:
                  text,

                instructions:
                  "Speak clearly and naturally for a short-form social media video. Use an engaging, confident and conversational tone. Do not sound robotic.",

                response_format:
                  "mp3",

                speed:
                  1.0
              }),

              signal:
                controller.signal
            }
          );
      } catch (error) {
        clearTimeout(timeout);

        if (
          error?.name ===
          "AbortError"
        ) {
          return res.status(504).json({
            success: false,
            error:
              "Voice generation timed out"
          });
        }

        return res.status(502).json({
          success: false,
          error:
            "Unable to connect to OpenAI voice service"
        });
      }

      clearTimeout(timeout);

      if (!response.ok) {
        let errorData = {};

        try {
          errorData =
            await response.json();
        } catch (_) {
          errorData = {};
        }

        return res.status(
          response.status
        ).json({
          success: false,
          error:
            errorData?.error?.message ||
            "OpenAI voice generation failed"
        });
      }

      const audioBuffer =
        Buffer.from(
          await response.arrayBuffer()
        );

      return res.status(200).json({
        success: true,

        audio:
          audioBuffer.toString(
            "base64"
          ),

        mimeType:
          "audio/mpeg",

        model:
          ttsModel,

        voice:
          ttsVoice
      });
    }

    /*
     * =====================================================
     * NORMAL AI CHAT
     * =====================================================
     */

    const apiKey =
      process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error:
          "OPENAI_API_KEY is missing in Vercel"
      });
    }

    const message =
      typeof req.body?.message ===
      "string"
        ? req.body.message.trim()
        : "";

    const conversation =
      Array.isArray(
        req.body?.conversation
      )
        ? req.body.conversation
        : [];

    if (
      !message &&
      conversation.length === 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Message is required"
      });
    }

    let input = [];

    if (conversation.length > 0) {
      input =
        conversation
          .filter((item) => {
            return (
              item &&
              typeof item ===
                "object" &&
              typeof item.role ===
                "string" &&
              typeof item.content ===
                "string" &&
              item.content.trim()
            );
          })
          .map((item) => ({
            role:
              item.role ===
              "assistant"
                ? "assistant"
                : "user",

            content:
              item.content.trim()
          }));
    }

    if (
      input.length === 0 &&
      message
    ) {
      input = [
        {
          role: "user",
          content: message
        }
      ];
    }

    if (input.length > 30) {
      input =
        input.slice(-30);
    }

    const textModel =
      process.env.OPENAI_TEXT_MODEL ||
      "gpt-4.1-mini";

    const controller =
      new AbortController();

    const timeout =
      setTimeout(() => {
        controller.abort();
      }, 60000);

    let response;

    try {
      response =
        await fetch(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              "Authorization":
                "Bearer " + apiKey
            },

            body: JSON.stringify({
              model:
                textModel,

              input:
                input,

              instructions:
                "You are the AI Command Centre assistant. Help the user create useful, accurate and practical content. When asked to create social media content, provide clear ready-to-use output. When discussing trading or investments, provide educational information only and never execute real financial transactions.",

              max_output_tokens:
                2000
            }),

            signal:
              controller.signal
          }
        );
    } catch (error) {
      clearTimeout(timeout);

      if (
        error?.name ===
        "AbortError"
      ) {
        return res.status(504).json({
          success: false,
          error:
            "OpenAI request timed out"
        });
      }

      return res.status(502).json({
        success: false,
        error:
          "Unable to connect to OpenAI"
      });
    }

    clearTimeout(timeout);

    let data;

    try {
      data =
        await response.json();
    } catch (_) {
      return res.status(502).json({
        success: false,
        error:
          "OpenAI returned invalid JSON"
      });
    }

    if (!response.ok) {
      return res.status(
        response.status
      ).json({
        success: false,
        error:
          data?.error?.message ||
          "OpenAI request failed"
      });
    }

    let reply = "";

    if (
      typeof data?.output_text ===
      "string"
    ) {
      reply =
        data.output_text.trim();
    }

    if (
      !reply &&
      Array.isArray(
        data?.output
      )
    ) {
      const parts = [];

      for (
        const item of data.output
      ) {
        if (
          !Array.isArray(
            item?.content
          )
        ) {
          continue;
        }

        for (
          const part of
            item.content
        ) {
          if (
            part?.type ===
              "output_text" &&
            typeof part?.text ===
              "string"
          ) {
            parts.push(
              part.text
            );
          }
        }
      }

      reply =
        parts.join("\n").trim();
    }

    if (!reply) {
      return res.status(500).json({
        success: false,
        error:
          "OpenAI returned no text response"
      });
    }

    return res.status(200).json({
      success: true,

      reply:
        reply,

      model:
        textModel
    });

  } catch (error) {
    console.error(
      "AI Command Centre API Error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Server error"
    });
  }
};
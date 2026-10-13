'use strict';

const SYMBOLS = Object.freeze({
  // India
  NIFTY: '^NSEI',
  SENSEX: '^BSESN',
  RELIANCE: 'RELIANCE.NS',
  TCS: 'TCS.NS',
  INFY: 'INFY.NS',
  HDFCBANK: 'HDFCBANK.NS',
  ICICIBANK: 'ICICIBANK.NS',
  SBIN: 'SBIN.NS',

  // International stocks
  AAPL: 'AAPL',
  MSFT: 'MSFT',
  GOOGL: 'GOOGL',
  AMZN: 'AMZN',
  NVDA: 'NVDA',
  TSLA: 'TSLA',
  META: 'META',
  NFLX: 'NFLX',
  AMD: 'AMD',
  INTC: 'INTC',
  ORCL: 'ORCL',
  IBM: 'IBM',
  JPM: 'JPM',
  V: 'V',
  WMT: 'WMT',
  DIS: 'DIS',
  BABA: 'BABA',
  TSM: 'TSM',

  // ETFs
  SPY: 'SPY',
  QQQ: 'QQQ',
  DIA: 'DIA',
  IWM: 'IWM',

  // Crypto, commodities and forex
  'BTC-USD': 'BTC-USD',
  'ETH-USD': 'ETH-USD',
  'GC=F': 'GC=F',
  'SI=F': 'SI=F',
  'CL=F': 'CL=F',
  'EURUSD=X': 'EURUSD=X',
  'GBPUSD=X': 'GBPUSD=X',
  'USDJPY=X': 'USDJPY=X'
});

const MAX_BODY_CHARS = 40000;
const CHAT_MODEL =
  process.env.GEMINI_CHAT_MODEL || 'gemini-3.1-flash-lite';
const TTS_MODEL =
  process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(data));
}

function timeoutSignal(ms) {
  return AbortSignal.timeout(ms);
}

async function readJsonResponse(response, label) {
  const raw = await response.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch (_) {
    throw new Error(
      label + ' returned an invalid response (HTTP ' +
      response.status + ').'
    );
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      label + ' request failed (HTTP ' + response.status + ').';

    const error = new Error(message);
    error.statusCode = response.status === 429 ? 429 : 502;
    throw error;
  }

  return data;
}

function extractGeminiText(data) {
  return (data?.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || '')
    .join('')
    .trim();
}

function pcmToWavBase64(
  base64Pcm,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16
) {
  const pcm = Buffer.from(base64Pcm, 'base64');
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]).toString('base64');
}

async function getMarketData(symbol) {
  const key = String(symbol || '').trim().toUpperCase();
  const yahooSymbol = SYMBOLS[key];

  if (!yahooSymbol) {
    const error = new Error(
      'Unsupported symbol. Choose an instrument listed in the Market Monitor.'
    );
    error.statusCode = 400;
    throw error;
  }

  const url =
    'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(yahooSymbol) +
    '?range=5d&interval=1d';

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 AICommandCentre/1.0'
    },
    signal: timeoutSignal(12000)
  });

  const data = await readJsonResponse(response, 'Market data provider');
  const result = data?.chart?.result?.[0];

  if (!result) {
    throw new Error(
      data?.chart?.error?.description ||
      'No market data was returned for ' + key + '.'
    );
  }

  const meta = result.meta || {};
  const quotes = result.indicators?.quote?.[0] || {};
  const closes = (quotes.close || []).filter(Number.isFinite);

  const current = Number.isFinite(meta.regularMarketPrice)
    ? meta.regularMarketPrice
    : closes.at(-1);

  const previous = Number.isFinite(meta.chartPreviousClose)
    ? meta.chartPreviousClose
    : Number.isFinite(meta.previousClose)
      ? meta.previousClose
      : closes.at(-2);

  if (!Number.isFinite(current)) {
    throw new Error('The provider returned no usable price for ' + key + '.');
  }

  const change = Number.isFinite(previous)
    ? current - previous
    : null;

  return {
    success: true,
    symbol: key,
    providerSymbol: yahooSymbol,
    name: meta.longName || meta.shortName || key,
    price: current,
    currency: meta.currency || 'Unknown',
    exchange: meta.exchangeName || null,
    previousClose: Number.isFinite(previous) ? previous : null,
    change,
    changePercent:
      Number.isFinite(previous) && previous !== 0
        ? change / previous * 100
        : null,
    marketState: meta.marketState || 'UNKNOWN',
    asOf: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : null,
    disclaimer:
      'Market data may be delayed or unavailable. Not financial advice.'
  };
}

async function generateChat(message, conversation) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    const error = new Error(
      'Missing GEMINI_API_KEY in Vercel Project Settings → Environment Variables.'
    );
    error.statusCode = 503;
    throw error;
  }

  const history = Array.isArray(conversation)
    ? conversation.slice(-12).map(item => {
        const role =
          item?.role === 'model' || item?.role === 'assistant'
            ? 'model'
            : 'user';

        return {
          role,
          parts: [{
            text: String(item?.content ?? item?.text ?? '').slice(0, 8000)
          }]
        };
      }).filter(item => item.parts[0].text.trim())
    : [];

  const contents = [
    ...history,
    { role: 'user', parts: [{ text: message }] }
  ];

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(CHAT_MODEL) +
    ':generateContent?key=' + encodeURIComponent(apiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.75,
          maxOutputTokens: 4096
        }
      }),
      signal: timeoutSignal(45000)
    }
  );

  const data = await readJsonResponse(response, 'Gemini AI');
  const reply = extractGeminiText(data);

  if (!reply) {
    throw new Error(
      'The AI returned an empty response. Please try again.'
    );
  }

  return { success: true, reply, model: CHAT_MODEL };
}

async function generateTts(text) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    const error = new Error(
      'Missing GEMINI_API_KEY in Vercel Project Settings → Environment Variables.'
    );
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(TTS_MODEL) +
    ':generateContent?key=' + encodeURIComponent(apiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text:
              'Read the following script clearly and naturally. ' +
              'Do not add any words before or after it.\n\n' + text
          }]
        }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' }
            }
          }
        }
      }),
      signal: timeoutSignal(60000)
    }
  );

  const data = await readJsonResponse(response, 'Gemini text-to-speech');
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const audioPart = parts.find(part => part.inlineData?.data);

  if (!audioPart) {
    throw new Error(
      'TTS returned no audio. Check whether the selected Gemini TTS model is enabled.'
    );
  }

  const mime = audioPart.inlineData.mimeType || 'audio/L16;rate=24000';
  const match = mime.match(/rate=(\d+)/i);
  const sampleRate = match ? Number(match[1]) : 24000;
  const wav = pcmToWavBase64(audioPart.inlineData.data, sampleRate);

  return {
    success: true,
    audio: wav,
    mimeType: 'audio/wav',
    model: TTS_MODEL
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, {
      success: false,
      error: 'Method not allowed. Use POST.'
    });
  }

  try {
    let body = req.body;

    if (typeof body === 'string') {
      if (body.length > MAX_BODY_CHARS) {
        return send(res, 413, {
          success: false,
          error: 'Request is too large.'
        });
      }

      try {
        body = JSON.parse(body);
      } catch (_) {
        return send(res, 400, {
          success: false,
          error: 'Request body must be valid JSON.'
        });
      }
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return send(res, 400, {
        success: false,
        error: 'Request body must be a JSON object.'
      });
    }

    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_CHARS) {
      return send(res, 413, {
        success: false,
        error: 'Request is too large.'
      });
    }

    const action = String(body.action || 'chat').trim().toLowerCase();

    if (action === 'market_data') {
      return send(res, 200, await getMarketData(body.symbol));
    }

    if (action === 'paper_trade') {
      // This endpoint only validates simulated orders.
      // It never connects to a broker or places real trades.
      const symbol = String(body.symbol || '')
        .trim()
        .toUpperCase()
        .slice(0, 32);

      const side = String(body.side || '').toUpperCase();
      const quantity = Number(body.quantity ?? body.qty);
      const price = Number(body.price);
      const total = quantity * price;

      if (
        !/^[A-Z0-9.^=\-]{1,32}$/.test(symbol) ||
        !['BUY', 'SELL'].includes(side) ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isFinite(total)
      ) {
        return send(res, 400, {
          success: false,
          error:
            'Invalid simulated order. Provide a symbol, BUY/SELL, ' +
            'positive whole quantity and positive price.'
        });
      }

      return send(res, 200, {
        success: true,
        simulated: true,
        message: 'Simulation only. No real order was sent.',
        order: {
          symbol,
          side,
          quantity,
          price,
          total,
          createdAt: new Date().toISOString()
        }
      });
    }

    if (action === 'tts') {
      const text = String(body.text || '').trim();

      if (!text) {
        return send(res, 400, {
          success: false,
          error: 'Text is required for voice generation.'
        });
      }

      if (text.length > 8000) {
        return send(res, 413, {
          success: false,
          error: 'Voiceover text is too long. Keep it under 8,000 characters.'
        });
      }

      return send(res, 200, await generateTts(text));
    }

    if (['chat', 'generate', 'content'].includes(action)) {
      const message = String(body.message || body.prompt || '').trim();

      if (!message) {
        return send(res, 400, {
          success: false,
          error: 'Please provide a message.'
        });
      }

      if (message.length > 20000) {
        return send(res, 413, {
          success: false,
          error: 'Message is too long.'
        });
      }

      return send(
        res,
        200,
        await generateChat(message, body.conversation)
      );
    }

    return send(res, 400, {
      success: false,
      error:
        'Unknown action. Supported actions: chat, market_data, tts, paper_trade.'
    });
  } catch (error) {
    const status =
      Number.isInteger(error.statusCode)
        ? error.statusCode
        : error.name === 'TimeoutError' || error.name === 'AbortError'
          ? 504
          : 502;

    // Do not log request bodies or API keys.
    console.error('[api/chat]', error?.message || 'Request failed');

    return send(res, status, {
      success: false,
      error: error?.message || 'Server request failed.'
    });
  }
};

module.exports._test = {
  SYMBOLS,
  pcmToWavBase64,
  extractGeminiText
};
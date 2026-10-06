async function handler(req) {
  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405 }
    );
  }

  try {
    const { message } = await req.json();

    if (!message || !message.trim()) {
      return Response.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { error: "OPENAI_API_KEY is missing in Vercel." },
        { status: 500 }
      );
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 8000);

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-6-luna",
          input: message,
          max_output_tokens: 200
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    const data = await response.json();

    if (!response.ok) {
      return Response.json(
        {
          error:
            data.error?.message ||
            "OpenAI request failed"
        },
        { status: response.status }
      );
    }

    return Response.json({
      reply: data.output_text || "No response received."
    });

  } catch (error) {

    if (error.name === "AbortError") {
      return Response.json(
        { error: "OpenAI request timed out." },
        { status: 504 }
      );
    }

    return Response.json(
      {
        error:
          error.message ||
          "Server error"
      },
      { status: module.exports = handler;
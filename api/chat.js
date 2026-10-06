export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { message } = await req.json();

    if (!message || !message.trim()) {
      return Response.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-6-luna",
        input: message
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return Response.json(
        { error: data.error?.message || "OpenAI request failed" },
        { status: response.status }
      );
    }

    return Response.json({
      reply: data.output_text || "No response received."
    });

  } catch (error) {
    return Response.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
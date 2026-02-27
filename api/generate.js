export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: "ANTHROPIC_API_KEY não configurada" });

  try {
    const { prompt, model, max_tokens } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ ok: false, error: "Envie { prompt: string }" });
    }

    const payload = {
      model: model || "claude-3-5-sonnet-latest",
      max_tokens: Number.isFinite(max_tokens) ? max_tokens : 400,
      messages: [{ role: "user", content: prompt }],
    };

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ ok: false, error: "Erro Anthropic", details: data });

    const text = (data.content || [])
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    return res.status(200).json({ ok: true, text });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Falha geral", details: String(e) });
  }
}

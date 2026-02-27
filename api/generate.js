export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada" });

  try {
    const { prompts, system, model } = req.body || {};

    if (!Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({ error: "Envie { prompts: [..] }" });
    }

    const consolidated = `
Responda em JSON puro e válido.
Formato:
{
  "items": [
    {"id": 1, "text": "..."},
    {"id": 2, "text": "..."}
  ]
}

PROMPTS:
${prompts.map((p, i) => `\n[${i + 1}] ${p}`).join("\n")}
`;

    const payload = {
      model: model || "claude-3-5-sonnet-latest",
      max_tokens: 1600,
      system: system || "Retorne textos em PT-BR. Direto e útil. Apenas JSON válido.",
      messages: [{ role: "user", content: consolidated }],
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
    if (!r.ok) return res.status(r.status).json({ error: "Erro Anthropic", details: data });

    const text = (data.content || [])
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

    return res.status(200).json({ ok: true, result: parsed });
  } catch (e) {
    return res.status(500).json({ error: "Falha geral", details: String(e) });
  }
}

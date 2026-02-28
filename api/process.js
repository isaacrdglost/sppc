// /api/process.js
// Backend-first: recebe quiz, decide funil/nível, calcula arquétipo/score, chama Claude 1x,
// salva no Supabase e devolve JSON pronto pro frontend.

function clampText(s, max = 900) {
  if (!s) return "";
  s = String(s);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function classifyArea(openText) {
  const t = (openText || "").toLowerCase();
  const has = (...words) => words.some((w) => t.includes(w));

  if (has("dev","desenvolvedor","program","software","frontend","backend","dados","data","engenheiro","ti","cloud","ia")) return "tech";
  if (has("marketing","tráfego","trafego","social media","copy","conteúdo","conteudo","branding","seo")) return "digital";
  if (has("rh","recrut","finance","contáb","contab","adm","admin","comercial","vendas","operação","operacao")) return "adm";
  if (has("médic","medic","enfer","psico","nutri","fisi","odont","saúde","saude")) return "saude";
  if (has("advog","direito","juríd","jurid","arquit","engenharia civil","contador","contabilidade")) return "liberal";
  if (has("univers","faculdade","gradu","estud")) return "universitario";
  if (has("recém formado","recem formado","formado")) return "recem-formado";
  if (has("sem faculdade","sem graduação","sem graduacao")) return "sem-faculdade";

  return "adm";
}

const ARCHETYPES = {
  executor:{ name:"O Executor", phrase:'"Você não espera — você faz acontecer."', baseScore:78 },
  estrategista:{ name:"O Estrategista", phrase:'"Você vê o que os outros não veem antes de agir."', baseScore:82 },
  construtor:{ name:"O Construtor", phrase:'"Você não segue caminhos — você abre."', baseScore:75 },
  conector:{ name:"O Conector", phrase:'"Seu maior ativo é como você faz as pessoas se sentirem."', baseScore:80 },
  especialista:{ name:"O Especialista", phrase:'"Você é a pessoa que chamam quando o problema é difícil."', baseScore:85 },
  adaptador:{ name:"O Adaptador", phrase:'"Incerteza é onde você performa melhor."', baseScore:72 },
  protagonista:{ name:"O Protagonista", phrase:'"Você não nasceu para ficar em segundo plano."', baseScore:77 },
  transformador:{ name:"O Transformador", phrase:'"Você trabalha melhor quando acredita no que está fazendo."', baseScore:74 },
};

const NIVEL_LABELS = {
  iniciante:"iniciante (sem experiência formal)",
  intermediario:"intermediário (em crescimento ou transição)",
  avancado:"avançado (construindo marca profissional)",
};

const OBJ_LABELS = {
  reconhecido:"ser reconhecido e pago pelo que vale",
  crescer:"crescer rápido e assumir mais responsabilidade",
  proposito:"trabalhar com propósito e significado",
  liberdade:"ter liberdade e autonomia profissional",
};

const RESOLVE_LABELS = {
  analise:"análise profunda antes de agir",
  acao:"ação rápida e ajuste no caminho",
  colabo:"colaboração e construção conjunta",
  visao:"visão ampla do cenário antes de decidir",
};

const MOTIVA_LABELS = {
  meta:"metas claras e resultados mensuráveis",
  criacao:"liberdade para criar do seu jeito",
  desafio:"desafios difíceis e complexos",
  crescimento:"aprendizado e evolução contínua",
};

const TRAVA_LABELS = {
  "sem-retorno":"currículo não gera retorno",
  "vagas-erradas":"aparece em vagas que não quer",
  inseguro:"insegurança sobre como se apresentar",
  "primeira-vez":"primeira experiência no processo",
};

function computeArchetype(Q) {
  const scores = {
    executor:0, estrategista:0, construtor:0, conector:0,
    especialista:0, adaptador:0, protagonista:0, transformador:0
  };

  const obj = Q?.answers?.["3"];
  if (obj==="reconhecido") {scores.executor+=2; scores.protagonista+=2;}
  if (obj==="crescer") {scores.protagonista+=2; scores.executor+=1; scores.construtor+=1;}
  if (obj==="proposito") {scores.transformador+=3; scores.conector+=1;}
  if (obj==="liberdade") {scores.construtor+=3; scores.adaptador+=1;}

  const res = Q?.answers?.["4"];
  if (res==="analise") {scores.estrategista+=3; scores.especialista+=2;}
  if (res==="acao") {scores.executor+=3; scores.adaptador+=1;}
  if (res==="colabo") {scores.conector+=3; scores.transformador+=1;}
  if (res==="visao") {scores.estrategista+=2; scores.construtor+=2;}

  const mot = Q?.answers?.["5"];
  if (mot==="meta") {scores.executor+=2; scores.especialista+=1;}
  if (mot==="criacao") {scores.construtor+=2; scores.protagonista+=1;}
  if (mot==="desafio") {scores.especialista+=2; scores.executor+=1;}
  if (mot==="crescimento") {scores.adaptador+=2; scores.transformador+=1;}

  return Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0];
}

function computeScore(archetypeKey, Q) {
  const base = ARCHETYPES[archetypeKey]?.baseScore ?? 75;
  let bonus = 0;
  if (Array.isArray(Q?.answers?.["7"]) && Q.answers["7"].length >= 2) bonus += 4;
  if ((Q?.answers?.["8"] || "").length > 80) bonus += 3;
  if (Q?.level === "intermediario") bonus += 2;
  return Math.min(base + bonus, 97);
}

function normalizeNivel(raw) {
  const n = String(raw || "intermediario").toLowerCase().trim();
  if (n === "iniciante" || n === "intermediario" || n === "avancado") return n;
  return "intermediario";
}

function computeFunil(nivel) {
  return (nivel === "avancado") ? "avancado" : "padrao";
}

function computePricing(nivel) {
  // Você pode ajustar aqui depois sem tocar no front.
  if (nivel === "iniciante") return { price: "27", priceFrom: "49,99" };
  return { price: "47", priceFrom: "99,99" };
}

async function callClaudeServer({ apiKey, prompt, model, max_tokens }) {
  const payload = {
    model: "claude-sonnet-4-6",
    max_tokens: Number.isFinite(max_tokens) ? max_tokens : 900,
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
  if (!r.ok) {
    const err = new Error("Anthropic error");
    err.details = data;
    throw err;
  }

  return (data.content || [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

// Supabase (server only)
async function supabaseInsertLead(payload) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const r = await fetch(`${url}/rest/v1/leads`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apikey": key,
      "authorization": `Bearer ${key}`,
      "prefer": "return=representation",
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json();
  if (!r.ok) return null;
  return data?.[0] || null;
}

async function supabaseGetLeadById(id) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const r = await fetch(`${url}/rest/v1/leads?id=eq.${id}&select=*`, {
    headers: {
      "apikey": key,
      "authorization": `Bearer ${key}`,
    },
  });

  const data = await r.json();
  if (!r.ok) return null;
  return data?.[0] || null;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ ok:false, error:"ANTHROPIC_API_KEY não configurada no Vercel" });

  try {
    const { quiz, lead_id } = req.body || {};
    if (!quiz || typeof quiz !== "object") {
      return res.status(400).json({ ok:false, error:"Envie { quiz: {...} }" });
    }

    // Nível/funil é decisão de backend
    const Q = quiz;
    const nivel = normalizeNivel(Q.level);
    const funil = computeFunil(nivel);
    const next_step = (funil === "avancado") ? "FUNIL_AVANCADO" : "RESULTADO_PADRAO";
    const pricing = computePricing(nivel);

    // ===== CACHE (se já existe resultado salvo) =====
    if (lead_id) {
      const existing = await supabaseGetLeadById(lead_id);
      if (existing?.ai_preview && existing?.score && existing?.archetype_name) {
        return res.status(200).json({
          ok: true,
          lead_id: existing.id,
          nivel: existing.nivel || nivel,
          funil: existing.funil || funil,
          next_step,
          price: pricing.price,
          priceFrom: pricing.priceFrom,
          primeiroNome: (existing.nome || "Você").split(" ")[0],
          cargo: existing.cargo_alvo || "Profissional",
          archetype: {
            key: existing.archetype_key || null,
            name: existing.archetype_name || null,
            phrase: ""
          },
          score: existing.score,
          ai: existing.ai_preview,
        });
      }
    }

    // Lead data
    const nomeFull = Q?.userData?.nome || "Você";
    const cargoAlvo = Q?.userData?.cargo || "Profissional";
    const primeiroNome = String(nomeFull).split(" ")[0] || "Você";

    // Área só pra enriquecer IA (não precisa salvar como core)
    let area = Q?.answers?.["2"] || "adm";
    if (String(area).startsWith("outro")) area = classifyArea(Q.openArea || "");

    // Resultado determinístico
    const archetypeKey = computeArchetype(Q);
    const archetype = ARCHETYPES[archetypeKey];
    const score = computeScore(archetypeKey, Q);

    const pdata = {
      archetype: archetype.name,
      objetivo: OBJ_LABELS[Q?.answers?.["3"]] || "crescimento profissional",
      resolve: RESOLVE_LABELS[Q?.answers?.["4"]] || "análise e execução",
      motiva: MOTIVA_LABELS[Q?.answers?.["5"]] || "desafios e resultados",
      trava: TRAVA_LABELS[Q?.answers?.["6"]] || "posicionamento",
      area,
      nivel: NIVEL_LABELS[nivel] || nivel,
      habilidades: (Array.isArray(Q?.answers?.["7"]) ? Q.answers["7"].join(", ") : "") || "não especificadas",
      trajetoria: clampText(Q?.answers?.["8"] || "não informada", 900),
      nome: nomeFull,
      cargo: cargoAlvo,
    };

    // Se avançado: você pode trocar prompt/modelo aqui, ou até nem gerar currículo e mandar pra outro funil.
    // Por enquanto, mantém o preview (o front decide o funil com base no next_step).
    const prompt = `
Você é especialista em avaliação comportamental e posicionamento de carreira.
Gere APENAS JSON válido, sem markdown.

Regras:
- PT-BR
- direto, humano, sem clichês ("proativo", "dinâmico", etc.)
- não cite SPP/produto
- não invente fatos fora do perfil

Retorne neste formato:
{
  "perfil": "parágrafo (3 frases, 2ª pessoa)",
  "fortes": ["ponto 1 (<=12 palavras)", "ponto 2", "ponto 3"],
  "desenvolver": ["ponto 1", "ponto 2"],
  "posicionamento": "1 parágrafo com orientação prática",
  "sobreMim": "1 parágrafo pronto para currículo",
  "softSkills": ["skill 1", "skill 2", "skill 3", "skill 4"]
}

PERFIL:
Arquétipo: ${pdata.archetype}
Objetivo: ${pdata.objetivo}
Como resolve: ${pdata.resolve}
O que motiva: ${pdata.motiva}
Trava atual: ${pdata.trava}
Área: ${pdata.area}
Nível: ${pdata.nivel}
Habilidades: ${pdata.habilidades}
Trajetória: ${pdata.trajetoria}
Nome: ${pdata.nome}
Cargo alvo: ${pdata.cargo}
`;

    const raw = await callClaudeServer({
      apiKey,
      prompt,
      model: "claude-sonnet-4-6",
      max_tokens: 900, // custo controlado
    });

    let ai;
    try { ai = JSON.parse(raw); } catch { ai = null; }

    const safe = (ai && typeof ai === "object") ? ai : {
      perfil: `${primeiroNome}, seu perfil aponta para execução com direção e consistência. Você opera melhor com clareza de objetivo e ação contínua. Agora o foco é traduzir isso em posicionamento e resultado.`,
      fortes: ["Clareza de objetivo", "Ação consistente", "Comunicação objetiva"],
      desenvolver: ["Narrativa profissional", "Provas e resultados"],
      posicionamento: "Defina o que você entrega (resultado), para quem (contexto) e como (método).",
      sobreMim: `${primeiroNome} é um(a) profissional focado(a) em ${cargoAlvo}, buscando crescimento e clareza de posicionamento.`,
      softSkills: ["Comunicação","Organização","Resiliência","Pensamento crítico"],
    };

    // ===== SALVA LEAD + ESTADO DO PRODUTO =====
    const leadPayload = {
      // Lead
      nome: Q?.userData?.nome || null,
      email: Q?.userData?.email || null,
      whatsapp: Q?.userData?.whatsapp || Q?.userData?.telefone || null,
      cidade_uf: Q?.userData?.cidadeUF || Q?.userData?.cidade_uf || Q?.userData?.cidade || null,
      cargo_alvo: Q?.userData?.cargo || null,

      // Classificação / funil
      nivel,
      funil,

      // Resultado
      archetype_key: archetypeKey,
      archetype_name: archetype.name,
      score,
      quiz: Q,
      ai_preview: safe,

      // Pagamento
      paid: false,
      paid_at: null,
      payment_provider: null,
      payment_ref: null,
    };

    const leadRow = await supabaseInsertLead(leadPayload);

    return res.status(200).json({
      ok: true,
      lead_id: leadRow?.id || null,

      nivel,
      funil,
      next_step,

      price: pricing.price,
      priceFrom: pricing.priceFrom,

      primeiroNome,
      cargo: cargoAlvo,

      archetype: { key: archetypeKey, name: archetype.name, phrase: archetype.phrase },
      score,
      ai: safe,
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({
      ok:false,
      error:"Falha no /api/process",
      details: e?.details || String(e)
    });
  }
}

export function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function generateStructured({ name, schema, instructions, input, maxTokens = 3000 }) {
  if (!aiConfigured())
    throw Object.assign(new Error("La IA requiere OPENAI_API_KEY en la configuración del servidor."), { status: 503 });
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        store: false, instructions, input, max_output_tokens: maxTokens,
        text: { format: { type: "json_schema", name, strict: true, schema } },
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    const timeout = error.name === "TimeoutError";
    throw Object.assign(new Error(timeout ? "La IA tardó demasiado. Puedes intentar de nuevo." : "No se pudo conectar con la IA."),
      { status: timeout ? 504 : 502 });
  }
  if (!response.ok) {
    const messages = {
      401: "La clave de IA no es válida o venció. Contacta al administrador.",
      403: "El proyecto de IA no tiene acceso al modelo configurado.",
      429: "El servicio de IA alcanzó su límite o no tiene saldo disponible.",
    };
    throw Object.assign(new Error(messages[response.status] ?? "El servicio de IA no está disponible. Intenta más tarde."),
      { status: 503 });
  }
  const data = await response.json();
  if (data.status !== "completed") throw Object.assign(new Error("La IA no completó la lectura. Prueba con una imagen más pequeña."), { status: 502 });
  const text = data.output?.filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("La IA no pudo producir un resultado válido."), { status: 502 });
  }
}

export function reserveAIRequest(db, userId, kind, fail) {
  const since = Date.now() - 3600000;
  const count = db.prepare("SELECT COUNT(*) total FROM ai_requests WHERE actor_id=? AND created_at>?").get(userId, since).total;
  if (count >= 20) fail(429, "Alcanzaste 20 consultas de IA en una hora. Intenta más tarde.");
  db.prepare("INSERT INTO ai_requests(actor_id,kind,created_at) VALUES (?,?,?)").run(userId, kind, Date.now());
}

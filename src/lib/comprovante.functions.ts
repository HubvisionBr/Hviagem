// Leitura do comprovante (foto ou PDF) pelo Gemini. Roda no servidor para a chave
// da API nunca chegar ao navegador. O resultado é só uma sugestão: o usuário confere e confirma.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TIPOS_DESPESA } from "@/lib/constants";

// Modelo rápido primeiro (a pessoa está esperando no celular); se ele estiver
// indisponível ou sobrecarregado, tenta uma vez o modelo reserva.
const MODELO_PADRAO = "gemini-3.5-flash-lite";
const MODELO_RESERVA = "gemini-3.5-flash";
const TIMEOUT_MS = [20_000, 35_000];
const MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
// ~10 MB de arquivo em base64 (o Gemini aceita até 20 MB por requisição).
const MAX_BASE64 = 14_000_000;

export type ComprovanteLido = {
  eComprovante: boolean;
  tipo: (typeof TIPOS_DESPESA)[number] | null;
  valor: number | null;
  data: string | null;
  descricao: string | null;
};

const PROMPT = `Você lê comprovantes de despesas corporativas brasileiras (nota fiscal, cupom fiscal, recibo, comprovante de cartão ou Pix, recibo de aplicativo de transporte, pedágio etc.).
Extraia do documento anexado:
- e_comprovante: false se a imagem não for um comprovante de despesa legível.
- tipo_despesa: a categoria que melhor descreve a despesa.
- valor: o valor TOTAL efetivamente pago, em reais, como número (ex.: 45.9). Não use subtotal, troco nem valor de item.
- data_despesa: a data da compra no formato AAAA-MM-DD. Datas brasileiras são dia/mês/ano.
- descricao: resumo curto (até 80 caracteres) com o estabelecimento e o que foi comprado, ex.: "Almoço — Restaurante Sabor da Terra".
Se um campo não estiver visível ou legível, devolva null nele. Nunca invente valores.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    e_comprovante: { type: "BOOLEAN" },
    tipo_despesa: { type: "STRING", enum: [...TIPOS_DESPESA], nullable: true },
    valor: { type: "NUMBER", nullable: true },
    data_despesa: { type: "STRING", nullable: true },
    descricao: { type: "STRING", nullable: true },
  },
  required: ["e_comprovante", "tipo_despesa", "valor", "data_despesa", "descricao"],
};

export const lerComprovante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { base64: string; mimeType: string }) => {
    const mimeType = String(d?.mimeType ?? "");
    const base64 = String(d?.base64 ?? "");
    if (!MIMES.includes(mimeType)) throw new Error("Envie uma imagem ou PDF.");
    if (!base64) throw new Error("Arquivo vazio.");
    if (base64.length > MAX_BASE64) throw new Error("Arquivo muito grande para a leitura automática.");
    return { base64, mimeType };
  })
  .handler(async ({ data }): Promise<ComprovanteLido> => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Leitura automática não configurada (GEMINI_API_KEY).");
    const modelos = [...new Set([process.env.GEMINI_MODEL || MODELO_PADRAO, MODELO_RESERVA])];
    const payload = JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: data.mimeType, data: data.base64 } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
    });

    let res: Response | null = null;
    for (const [i, modelo] of modelos.entries()) {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: payload,
          signal: AbortSignal.timeout(TIMEOUT_MS[i] ?? TIMEOUT_MS[0]),
        },
      ).catch(() => null);
      if (res?.ok) break;
      console.error("[gemini]", modelo, res?.status ?? "sem resposta", res ? (await res.text()).slice(0, 300) : "");
      // Só vale tentar o reserva se o problema for do modelo (fora do ar, sobrecarga, tempo esgotado).
      if (res && ![404, 429, 500, 503].includes(res.status)) break;
    }

    if (!res) throw new Error("A leitura automática não respondeu. Preencha manualmente.");
    if (!res.ok) {
      if (res.status === 429) throw new Error("Limite da leitura automática atingido. Preencha manualmente.");
      throw new Error("Não foi possível ler o comprovante. Preencha manualmente.");
    }

    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const texto = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    let bruto: Record<string, unknown>;
    try {
      bruto = JSON.parse(texto);
    } catch {
      throw new Error("Não foi possível ler o comprovante. Preencha manualmente.");
    }

    // Nunca confia cegamente na resposta do modelo: valida campo a campo.
    const tipo = TIPOS_DESPESA.find((t) => t === bruto.tipo_despesa) ?? null;
    const valorNum = typeof bruto.valor === "number" ? Math.round(bruto.valor * 100) / 100 : NaN;
    const valor = Number.isFinite(valorNum) && valorNum > 0 && valorNum < 1_000_000 ? valorNum : null;
    const dataStr = typeof bruto.data_despesa === "string" ? bruto.data_despesa : "";
    const dataOk = /^\d{4}-\d{2}-\d{2}$/.test(dataStr) && !Number.isNaN(Date.parse(dataStr));
    const descricao =
      typeof bruto.descricao === "string" && bruto.descricao.trim() ? bruto.descricao.trim().slice(0, 120) : null;

    return {
      eComprovante: bruto.e_comprovante !== false,
      tipo,
      valor,
      data: dataOk ? dataStr : null,
      descricao,
    };
  });

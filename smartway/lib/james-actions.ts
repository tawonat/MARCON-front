import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type { Account } from "./accounts";
import { ActionError, demand, integer } from "./permissions";
import { workspaceSnapshot } from "./workspace-db";
import { executeWorkspaceAction } from "./workspace-actions";
import { dashboardReport } from "./dashboard-report";
import { jamesPlan } from "./james-model";
export type JamesCart = {
  code: string;
  quantity: number;
  priority: "Leve" | "Moderado" | "Urgente";
  justification: string;
}[];
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const mac = (s: string) =>
  createHmac("sha256", process.env.SESSION_SECRET!)
    .update("james-confirm:" + s)
    .digest("base64url");
function ticket(user: Account, entries: JamesCart) {
  const data = Buffer.from(
    JSON.stringify({
      user: user.id,
      role: user.role,
      block: user.block,
      entries,
      key: randomUUID(),
      until: Date.now() + 10 * 60000,
    }),
  ).toString("base64url");
  return data + "." + mac(data);
}
export async function confirmJames(
  user: Account,
  token: unknown,
  confirmation: unknown,
) {
  demand(user, "request");
  if (
    typeof token !== "string" ||
    token.length > 32000 ||
    confirmation !== "confirmar requisicao"
  )
    throw new ActionError("Confirme explicitamente o resumo exibido.", 400);
  const [data, signature, ...extra] = token.split(".");
  const expected = Buffer.from(mac(data || "")),
    received = Buffer.from(signature || "");
  if (
    extra.length ||
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    throw new ActionError("Resumo invalido. Revise novamente.", 403);
  const t = JSON.parse(Buffer.from(data, "base64url").toString());
  if (
    t.user !== user.id ||
    t.role !== user.role ||
    t.block !== user.block ||
    t.until < Date.now()
  )
    throw new ActionError(
      "Resumo expirado ou fora do seu perfil. Revise novamente.",
      403,
    );
  const result = await executeWorkspaceAction(user, {
    type: "createRequests",
    entries: t.entries,
    requestKey: t.key,
  });
  return {
    reply:
      "Requisicao registrada. Voce pode acompanhar o pedido na pagina de requisicoes.",
    result,
    cart: [],
    submitted: true,
  };
}
export async function converseJames(
  user: Account,
  input: Record<string, unknown>,
  signal: AbortSignal,
) {
  const message = input.message;
  if (typeof message !== "string" || !message.trim() || message.length > 2000)
    throw new ActionError("Digite uma mensagem de ate 2000 caracteres.");
  if (!Array.isArray(input.cart) || input.cart.length > 30)
    throw new ActionError("Carrinho invalido.");
  const { stock } = await workspaceSnapshot(user, true);
  const byCode = new Map(stock.map((p) => [p.code, p]));
  let cart: JamesCart = input.cart.map((e) => {
    if (
      !e ||
      typeof e.code !== "string" ||
      !byCode.has(e.code) ||
      !["Leve", "Moderado", "Urgente"].includes(e.priority) ||
      typeof e.justification !== "string" ||
      e.justification.length > 1000
    )
      throw new ActionError("Revise os itens do carrinho.");
    return {
      code: e.code,
      quantity: integer(e.quantity),
      priority: e.priority,
      justification: e.justification,
    };
  });
  if (new Set(cart.map((e) => e.code)).size !== cart.length)
    throw new ActionError("Itens repetidos no carrinho.");
  if (cart.length) demand(user, "request");
  const describe = () =>
    cart.map((e) => {
      const p = byCode.get(e.code)!;
      return {
        ...e,
        name: p.name,
        unit: p.unit || "un",
        packSize: p.packSize,
        available: p.available ?? p.quantity,
      };
    });
  const simple = normalize(message).replace(/[.!?]/g, "");
  const correction = simple.match(
    /^(?:troque|mude|altere|ajuste)\s+(?:as\s+)?(caixas|embalagens|unidades)\s+(?:para|pra)\s+(\d+)$/,
  );
  const correctionItems = correction
    ? cart.filter(
        (e) => correction[1] === "unidades" || byCode.get(e.code)!.packSize > 1,
      )
    : [];
  if (correction && correctionItems.length !== 1)
    return {
      reply:
        "Qual item do carrinho deseja corrigir? Informe o código e a quantidade. Nenhuma alteração foi aplicada.",
      cart: input.cart,
      choices: correctionItems.map((e) => ({
        code: e.code,
        name: byCode.get(e.code)!.name,
      })),
    };
  const justification = message.match(/^justificativa\s*:\s*(.+)$/i);
  const history = Array.isArray(input.history)
    ? input.history
        .slice(-6)
        .filter((v) => typeof v === "string")
        .map((v) => v.slice(0, 2000))
    : [];
  const steps = correction
    ? [
        {
          action: "set" as const,
          query: correctionItems[0].code,
          quantity: integer(Number(correction[2])),
          unit: correction[1] === "unidades" ? "unit" : "package",
        },
      ]
    : justification
      ? [{ action: "justify" as const, reason: justification[1] }]
      : simple === "mostre meu carrinho"
        ? [{ action: "cart" as const }]
        : ["faca a requisicao", "revisar requisicao"].includes(simple)
          ? [{ action: "review" as const }]
          : await jamesPlan(
              message,
              {
                page:
                  typeof input.page === "string"
                    ? input.page.slice(0, 180)
                    : "",
                role: user.role,
                today: new Date().toISOString().slice(0, 10),
                cart: describe(),
                history,
              },
              signal,
            );
  const replies: string[] = [];
  let review = false;
  let dashboard: unknown;
  let href: string | undefined;
  for (const step of steps) {
    if (
      ["add", "set", "remove", "review", "cart", "justify"].includes(
        step.action,
      )
    )
      demand(user, "request");
    if (["add", "set", "remove", "find"].includes(step.action)) {
      const q = normalize(step.query || "");
      const tokens = q
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => t.replace(/s$/, ""));
      let matches = stock.filter((p) => normalize(p.code) === q);
      if (!matches.length)
        matches = stock.filter(
          (p) =>
            tokens.length &&
            tokens.every((t) => normalize(p.name + " " + p.code).includes(t)),
        );
      if (["set", "remove"].includes(step.action))
        matches = matches.filter((p) => cart.some((e) => e.code === p.code));
      if (step.action === "find") {
        replies.push(
          matches.length
            ? matches
                .slice(0, 8)
                .map(
                  (p) =>
                    `${p.code}: ${p.name}. Disponivel: ${p.available ?? p.quantity} ${p.unit || "un"}. Embalagem: ${p.packSize} ${p.unit || "un"}.`,
                )
                .join("\n")
            : "Nao encontrei esse item. Informe o codigo ou outro nome.",
        );
        continue;
      }
      if (matches.length !== 1)
        return {
          reply: matches.length
            ? "Encontrei mais de uma opcao. Informe o codigo exato e repita o pedido. Nenhuma alteracao foi aplicada."
            : "Qual item? Informe o codigo ou nome completo. Nenhuma alteracao foi aplicada.",
          choices: matches
            .slice(0, 8)
            .map((p) => ({ code: p.code, name: p.name })),
          cart: input.cart,
        };
      const p = matches[0];
      if (step.action === "remove") {
        cart = cart.filter((e) => e.code !== p.code);
        replies.push(`${p.name} removido do carrinho.`);
        continue;
      }
      if (!step.quantity || !["unit", "package"].includes(step.unit || ""))
        return {
          reply: `Quantas unidades ou embalagens de ${p.name}? Cada embalagem tem ${p.packSize} ${p.unit || "un"}. Nenhuma alteracao foi aplicada.`,
          cart: input.cart,
        };
      const qtty = integer(
        step.quantity * (step.unit === "package" ? p.packSize : 1),
      );
      const existing = cart.find((e) => e.code === p.code);
      const total =
        step.action === "add" ? (existing?.quantity || 0) + qtty : qtty;
      if (total > (p.available ?? p.quantity))
        return {
          reply: `${p.name}: ha apenas ${p.available ?? p.quantity} ${p.unit || "un"} disponiveis. Ajuste a quantidade. Nenhuma alteracao foi aplicada.`,
          cart: input.cart,
        };
      cart = cart.filter((e) => e.code !== p.code);
      cart.push({
        code: p.code,
        quantity: total,
        priority: existing?.priority || "Leve",
        justification: existing?.justification || "",
      });
      replies.push(
        `${p.name}: ${total} ${p.unit || "un"} no carrinho${step.unit === "package" ? ` (${step.quantity} embalagens de ${p.packSize})` : ""}.`,
      );
    } else if (step.action === "justify") {
      if (
        !step.reason?.trim() ||
        !normalize(message).includes(normalize(step.reason))
      )
        throw new ActionError(
          "Informe a justificativa com suas palavras: justificativa: seu motivo.",
        );
      cart = cart.map((e) => ({ ...e, justification: step.reason!.trim() }));
      replies.push("Justificativa atualizada.");
    } else if (step.action === "review") review = true;
    else if (step.action === "cart")
      replies.push(
        cart.length
          ? "Confira seu carrinho abaixo."
          : "Seu carrinho esta vazio.",
      );
    else if (step.action === "dashboard") {
      const view =
        step.view ||
        (user.role === "funcionario"
          ? "requisicoes"
          : user.role === "lider"
            ? "bloco"
            : "geral");
      const report = await dashboardReport(
        user,
        new URLSearchParams({
          ...step.filters,
          dashboard: view,
          pageSize: "5",
        }),
      );
      dashboard = {
        scope: report.scope,
        period: report.filters.from + " a " + report.filters.to,
        metrics: report.metrics.filter((m) =>
          ["requests", "pending", "urgent", "delivery"].includes(m.id),
        ),
        updatedAt: report.generatedAt,
      };
      href =
        user.role === "funcionario"
          ? "/employee/history"
          : user.role === "lider"
            ? "/department-head/dashboard"
            : user.role === "almoxarifado"
              ? "/warehouse/dashboard"
              : "/admin/dashboard";
      href +=
        "?" +
        new URLSearchParams({
          ...step.filters,
          james: "1",
          dashboard: view,
        }).toString();
      replies.push(
        `Indicadores de ${report.scope}. Pedidos criados nao representam retirada. Use Abrir dashboard para consultar os detalhes.`,
      );
    } else
      replies.push(
        "Posso buscar materiais, ajustar seu carrinho, revisar uma requisicao e explicar indicadores autorizados. Diga, por exemplo: procure parafusos.",
      );
  }
  if (cart.length > 30)
    throw new ActionError("O carrinho aceita ate 30 itens.");
  let confirmationToken: string | undefined;
  if (review) {
    if (!cart.length) replies.push("Adicione um item antes de solicitar.");
    else if (
      cart.some(
        (e) =>
          e.quantity >
          (byCode.get(e.code)!.available ?? byCode.get(e.code)!.quantity),
      )
    )
      replies.push("O saldo mudou. Revise as quantidades antes de enviar.");
    else if (
      cart.some(
        (e) =>
          (e.quantity > 10 || e.priority === "Urgente") &&
          !e.justification.trim(),
      )
    )
      replies.push(
        "Preciso da justificativa para quantidade acima de 10 ou urgência. Diga: justificativa: seguida do motivo. Depois peça para revisar.",
      );
    else {
      confirmationToken = ticket(user, cart);
      replies.push(
        `Revise: ${describe()
          .map(
            (e) => `${e.name}, ${e.quantity} ${e.unit}, urgência ${e.priority}`,
          )
          .join(
            "; ",
          )}. Bloco ${user.block}, setor ${user.sector}. Para enviar, diga ou clique Confirmar requisição. Para desistir, Cancelar. Nada foi enviado ainda.`,
      );
    }
  }
  return {
    reply: replies.join("\n"),
    cart,
    items: describe(),
    confirmationToken,
    dashboard,
    href,
    navigate: !!href && /\b(?:abra|abrir|acesse)\b/.test(normalize(message)),
    updatedAt: new Date().toISOString(),
  };
}

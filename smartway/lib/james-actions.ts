import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type { Account } from "./accounts";
import { ActionError, can, demand, integer } from "./permissions";
import { workspaceSnapshot } from "./workspace-db";
import { executeWorkspaceAction } from "./workspace-actions";
import { dashboardReport } from "./dashboard-report";
import { jamesPlan, type JamesStep } from "./james-model";
import { pathFor } from "./workspace-routes";
import { choiceIndex } from "./james-voice";
import { explicitOperation } from "./james-intents";
import {
  previewJamesOperation,
  executeJamesOperation,
  type JamesOperation,
  parseJamesOperation,
} from "./james-operations";
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
function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "America/Sao_Paulo",
    }).format(new Date()),
  );
  return hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
}
const mac = (s: string) =>
  createHmac("sha256", process.env.SESSION_SECRET!)
    .update("james-confirm:" + s)
    .digest("base64url");
function ticket(
  user: Account,
  entries: JamesCart,
  continuation?: { steps: JamesStep[]; index: number; choices: string[] },
  operation?: JamesOperation,
  operationSummary?: string,
) {
  const data = Buffer.from(
    JSON.stringify({
      user: user.id,
      role: user.role,
      block: user.block,
      entries,
      kind: operation
        ? "operation"
        : continuation
          ? "clarification"
          : "request",
      operation,
      operationSummary,
      continuation,
      key: randomUUID(),
      until: Date.now() + 10 * 60000,
    }),
  ).toString("base64url");
  return data + "." + mac(data);
}
function readTicket(user: Account, token: unknown, kind: string) {
  if (typeof token !== "string" || token.length > 32000)
    throw new ActionError("Resumo inválido. Revise novamente.", 403);
  const [data, signature, ...extra] = token.split(".");
  const expected = Buffer.from(mac(data || "")),
    received = Buffer.from(signature || "");
  if (
    extra.length ||
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    throw new ActionError("Resumo inválido. Revise novamente.", 403);
  const t = JSON.parse(Buffer.from(data, "base64url").toString());
  if (
    t.kind !== kind ||
    t.user !== user.id ||
    t.role !== user.role ||
    t.block !== user.block ||
    t.until < Date.now()
  )
    throw new ActionError(
      "Resumo expirado ou fora do seu perfil. Revise novamente.",
      403,
    );
  return t;
}
export async function confirmJames(
  user: Account,
  token: unknown,
  confirmation: unknown,
) {
  if (confirmation === "confirmar acao") {
    const t = readTicket(user, token, "operation");
    return executeJamesOperation(user, t.operation, t.key, t.operationSummary);
  }
  demand(user, "request");
  if (
    typeof token !== "string" ||
    token.length > 32000 ||
    confirmation !== "confirmar requisicao"
  )
    throw new ActionError("Confirme explicitamente o resumo exibido.", 400);
  const t = readTicket(user, token, "request");
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
  const casual = simple
    .replace(/\b(?:james|jhames)\b/g, "")
    .replace(/[,;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(?:(?:bom dia|boa tarde|boa noite|oi|ola)\s*)?(?:(?:como (?:vai|voce esta|esta voce|esta)(?: hoje)?|tudo bem)\s*)?$/.test(
      casual,
    ) &&
    casual
  )
    return {
      cart,
      reply: `${/^(bom dia|boa tarde|boa noite|oi|ola)/.test(casual) ? greeting() + "! " : ""}Estou pronto para ajudar. Como está seu dia?`,
      updatedAt: new Date().toISOString(),
    };
  if (/^(obrigad[oa]|valeu|muito obrigad[oa])$/.test(casual))
    return {
      cart,
      reply: "Por nada! Quando precisar, é só chamar.",
      updatedAt: new Date().toISOString(),
    };
  if (/^(cancelar|cancele|nao)$/.test(simple))
    return {
      reply:
        "Envio e esclarecimento cancelados. Seu carrinho foi mantido; requisições já registradas não foram canceladas.",
      cart,
      cancelled: true,
    };
  let continuation: JamesStep[] | undefined;
  if (input.clarificationToken) {
    const saved = readTicket(user, input.clarificationToken, "clarification");
    if (JSON.stringify(saved.entries) !== JSON.stringify(cart))
      throw new ActionError(
        "O carrinho mudou. Repita o pedido para revisar as quantidades.",
        409,
      );
    const ordinal = choiceIndex(message);
    const selected =
      ordinal === null ? message.trim() : saved.continuation.choices[ordinal];
    if (!saved.continuation.choices.includes(selected))
      throw new ActionError("Escolha um dos códigos apresentados.", 422);
    continuation = saved.continuation.steps;
    continuation![saved.continuation.index].query = selected;
  }
  const reordered = simple.replace(
    /^(troque|mude|altere|ajuste)\s+(?:para|pra)\s+(\d+)\s+(caixas|embalagens|unidades)$/,
    "$1 $3 para $2",
  );
  const correction = reordered.match(
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
  const operation = explicitOperation(message);
  const steps =
    continuation ??
    (operation
      ? [
          {
            action: "operation" as const,
            operation: parseJamesOperation(operation),
          },
        ]
      : undefined) ??
    (correction
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
                  operations:
                    user.role === "funcionario"
                      ? [
                          "editRequest",
                          "deleteRequest",
                          "requestCancellation",
                          "confirmReceipt",
                        ]
                      : user.role === "lider"
                        ? ["approve", "analyze"]
                        : user.role === "admin"
                          ? [
                              "approve",
                              "analyze",
                              "transfer",
                              "cancelTransfer",
                              "planRoute",
                              "stockEntry",
                              "adjustStock",
                            ]
                          : [
                              "transfer",
                              "cancelTransfer",
                              "planRoute",
                              "stockEntry",
                              "adjustStock",
                            ],
                  capabilities: can(user.role, "request")
                    ? [
                        "find",
                        "cart",
                        "add",
                        "set",
                        "remove",
                        "review",
                        "requests",
                        "export",
                        "navigate",
                      ]
                    : can(user.role, "planning")
                      ? [
                          "find",
                          "requests",
                          "dashboard",
                          "export",
                          "navigate",
                          "compra",
                          "recomendacoes",
                          "rotas",
                          "transferencias",
                        ]
                      : [
                          "find",
                          "requests",
                          "dashboard do próprio bloco",
                          "export",
                          "navigate",
                        ],
                  today: new Date().toISOString().slice(0, 10),
                  cart: describe(),
                  history,
                },
                signal,
              ));
  const replies: string[] = [];
  let review = false;
  let dashboard: unknown;
  let href: string | undefined;
  let hrefLabel: string | undefined;
  let exportHref: string | undefined;
  let records:
    | {
        id: string;
        item: string;
        quantity: number;
        unit: string;
        status: string;
        block: string;
        date: string;
      }[]
    | undefined;
  for (const [index, step] of steps.entries()) {
    if (step.action === "chat")
      return { reply: step.answer, cart, updatedAt: new Date().toISOString() };
    if (step.action === "operation") {
      if (
        step.operation?.reason &&
        !normalize(message).includes(normalize(step.operation.reason))
      )
        throw new ActionError(
          "Diga a justificativa com suas palavras, junto com a ação.",
          422,
        );
      const summary = await previewJamesOperation(user, step.operation!);
      return {
        reply: `${summary} Nada foi executado ainda. Diga Confirmar ação ou Cancelar.`,
        cart,
        confirmationToken: ticket(
          user,
          cart,
          undefined,
          step.operation,
          summary,
        ),
        confirmationKind: "operation",
        updatedAt: new Date().toISOString(),
      };
    }
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
      if (!matches.length) {
        const words = q.split(/[\s,;:()]+/);
        matches = stock.filter((p) => words.includes(normalize(p.code)));
      }
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
                    `${p.code}: ${p.name}. Disponível: ${p.available ?? p.quantity} ${p.unit || "un"}. Embalagem: ${p.packSize} ${p.unit || "un"}. Locais: ${
                      (p.locations ?? [])
                        .slice(0, 5)
                        .map(
                          (l) =>
                            `${l.warehouse}, ${l.aisle} / ${l.shelf}: ${l.available} disponíveis`,
                        )
                        .join("; ") || p.location
                    }.`,
                )
                .join("\n")
            : "Nao encontrei esse item. Informe o codigo ou outro nome.",
        );
        continue;
      }
      if (matches.length !== 1)
        return {
          reply: matches.length
            ? "Encontrei mais de uma opção. Escolha um item abaixo ou diga o código exato para continuar o pedido. Nenhuma alteração foi aplicada."
            : "Qual item? Informe o codigo ou nome completo. Nenhuma alteracao foi aplicada.",
          choices: matches
            .slice(0, 8)
            .map((p) => ({ code: p.code, name: p.name })),
          clarificationToken: matches.length
            ? ticket(user, input.cart as JamesCart, {
                steps,
                index,
                choices: matches.slice(0, 8).map((p) => p.code),
              })
            : undefined,
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
    else if (step.action === "navigate") {
      const target = step.view || "catalogo";
      if (["estoque", "transferencias", "rotas"].includes(target))
        demand(user, "stock");
      if (["compra", "recomendacoes"].includes(target))
        demand(user, "planning");
      if (target === "mapa") demand(user, "map");
      if (target === "funcionarios") demand(user, "people");
      if (target === "devolucoes") demand(user, "stock");
      if (target === "nova") demand(user, "request");
      if (target === "dashboard" && user.role === "funcionario")
        throw new ActionError("Use o histórico das suas requisições.", 403);
      const destinations: Record<string, [string, string]> = {
        perfil: [
          "/profile",
          "Dados de acesso e biometria são alterados na tela segura. Não dite sua senha para o assistente.",
        ],
        historico: [
          pathFor(user.role, "historico"),
          "Confira os registros do seu escopo e os filtros do histórico.",
        ],
        funcionarios: [
          pathFor(user.role, "funcionarios"),
          "Gerencie usuários e permissões na tela de cadastro. Senhas devem ser preenchidas na tela segura.",
        ],
        devolucoes: [
          pathFor(user.role, "devolucoes"),
          "Devoluções só voltam ao saldo após a conferência física.",
        ],
        nova: [
          pathFor(user.role, "nova"),
          "Busque materiais ou diga o nome, a quantidade e se deseja unidades ou embalagens.",
        ],
        dashboard: [
          pathFor(user.role, "dashboard"),
          "Indicadores respeitam seu perfil e o bloco autorizado.",
        ],
        catalogo: [
          "/catalogo",
          "Busque o material e confira a unidade e a embalagem cadastradas.",
        ],
        estoque: [
          user.role === "admin"
            ? "/admin/dashboard/stock"
            : pathFor(user.role, "estoque"),
          "Confira os saldos físico, reservado e disponível antes de movimentar.",
        ],
        requisicoes: [
          pathFor(
            user.role,
            user.role === "funcionario"
              ? "historico"
              : user.role === "lider"
                ? "solicitacoes"
                : "requisicoes",
          ),
          "Confira status e etapas. Aprovação e entrega exigem as permissões e confirmações da tela.",
        ],
        transferencias: [
          pathFor(user.role, "recomendacoes"),
          "Revise origem, destino e quantidade; solicitação, saída e recebimento são confirmados na fila de transferências.",
        ],
        rotas: [
          pathFor(user.role, "requisicoes"),
          "Abra uma entrega para calcular o caminho do mapa publicado. Sem mapa válido, opere manualmente. Calcular rota não baixa estoque.",
        ],
        recomendacoes: [
          pathFor(user.role, "recomendacoes"),
          "Sugestões usam baixas reais por bloco e proximidade no mapa; revise a base e confirme a transferência.",
        ],
        compra: [
          pathFor(user.role, "compra"),
          "Compras usam consumo efetivo, mínimos e reposições confirmadas. Confira período e fonte do preço.",
        ],
        mapa: [
          pathFor(user.role, "mapa"),
          "Revise pontos, passagens e bloqueios antes de publicar a versão.",
        ],
      };
      if (!destinations[target])
        throw new ActionError("Essa tela não está disponível.", 422);
      [href] = destinations[target];
      hrefLabel = "Abrir " + target;
      replies.push(destinations[target][1]);
    } else if (["dashboard", "requests", "export"].includes(step.action)) {
      const view =
        (step.action === "requests" ? "requisicoes" : step.view) ||
        (user.role === "funcionario"
          ? "requisicoes"
          : user.role === "lider"
            ? "bloco"
            : "geral");
      if (["compra", "recomendacoes"].includes(view)) demand(user, "planning");
      const reportQuery = new URLSearchParams({
        ...step.filters,
        dashboard: view === "recomendacoes" ? "estoque" : view,
        pageSize: "5",
        ...(["estoque", "compra", "recomendacoes"].includes(view)
          ? { metric: "stock" }
          : {}),
        ...(view === "recomendacoes" ? { planning: "distribution" } : {}),
      });
      const report = await dashboardReport(user, reportQuery);
      dashboard = {
        scope: report.scope,
        period: report.filters.from + " a " + report.filters.to,
        metrics: report.metrics,
        updatedAt: report.generatedAt,
      };
      if (step.action === "dashboard")
        replies.push(
          report.metrics
            .slice(0, 5)
            .map(
              (metric) =>
                `${metric.label}: ${metric.value === null ? "dados indisponíveis" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(metric.value)} ${metric.unit}.`,
            )
            .join("\n"),
        );
      if (step.action === "requests") {
        records = report.details.records.map((r) => ({
          id: r.id,
          item: r.item,
          quantity: r.quantity,
          unit: r.unit,
          status: r.status,
          block: r.block,
          date: r.date,
        }));
        replies.push(
          records.length
            ? records
                .map(
                  (r) =>
                    `${r.id}: ${r.item}, ${r.quantity} ${r.unit}, ${r.status}.`,
                )
                .join("\n")
            : "Nenhuma requisição no período e escopo selecionados.",
        );
      }
      if (step.action === "export") {
        if (!step.format)
          throw new ActionError("Escolha PDF ou planilha.", 422);
        reportQuery.set("format", step.format);
        if (["compra", "recomendacoes"].includes(view)) {
          reportQuery.delete("dashboard");
          reportQuery.set(
            "planning",
            view === "compra" ? "purchase" : "distribution",
          );
        }
        exportHref = "/api/operations?" + reportQuery;
        replies.push(
          "Exportação disponível abaixo, com os mesmos filtros e permissões. O arquivo será gerado pelo sistema ao baixar.",
        );
      }
      href =
        user.role === "funcionario"
          ? "/employee/history"
          : user.role === "lider"
            ? "/department-head/dashboard"
            : user.role === "almoxarifado"
              ? "/warehouse/dashboard"
              : "/admin/dashboard";
      if (view === "compra")
        href =
          user.role === "admin" ? "/admin/purchases" : "/warehouse/purchases";
      if (view === "recomendacoes") href = pathFor(user.role, "recomendacoes");
      hrefLabel = ["compra", "recomendacoes"].includes(view)
        ? "Abrir planejamento"
        : "Abrir dashboard";
      href +=
        "?" +
        new URLSearchParams({
          ...step.filters,
          james: "1",
          dashboard: view,
        }).toString();
      replies.push(
        `Dados de ${report.scope}, de ${report.filters.from} a ${report.filters.to}. Pedidos criados não representam retirada. Consulte os detalhes abaixo.`,
      );
    } else {
      const capabilities = [
        "buscar materiais e consultar registros autorizados",
      ];
      if (can(user.role, "request"))
        capabilities.push(
          "ajustar seu carrinho, revisar requisições e gerenciar seus pedidos",
        );
      if (can(user.role, "approve"))
        capabilities.push(
          "colocar pedidos em análise e aprovar dentro do seu escopo",
        );
      if (can(user.role, "stock"))
        capabilities.push(
          "solicitar transferências, registrar entradas ou ajustes conferidos e planejar rotas",
        );
      replies.push(
        `Posso ${capabilities.join("; ")}. Alterações exigem resumo e confirmação. Arquivos, leitura de códigos e conferência física continuam nas telas próprias. Diga, por exemplo: procure parafusos.`,
      );
    }
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
    hrefLabel,
    exportHref,
    records,
    navigate: !!href && /\b(?:abra|abrir|acesse)\b/.test(normalize(message)),
    updatedAt: new Date().toISOString(),
  };
}

"use client";

import { useState } from "react";
import { Download, Search } from "lucide-react";
import { heading } from "../ui";
import { useDemoStore } from "../demo-store";
import type { Part } from "@/lib/demo-data";
import { DashboardDialog } from "../operations/dashboard-dialog";

type PurchaseItem = {
  item: Part;
  projection: { arrival: number; buy: number; growth: number };
};

const currency = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function PurchaseScreen({
  purchaseItems,
}: {
  purchaseItems: PurchaseItem[];
}) {
  const { setStock, persistent, runAction } = useDemoStore();
  const [saveError, setSaveError] = useState("");
  const [draftCosts, setDraftCosts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [warehouse, setWarehouse] = useState("Todos");
  const [risk, setRisk] = useState("Todos");
  const [order, setOrder] = useState("risk");
  const [selected, setSelected] = useState<PurchaseItem | null>(null);

  function costFor(item: Part) {
    const draft = draftCosts[item.code];
    if (draft === undefined || draft.trim() === "") return item.estimatedCost;
    const value = Number(draft);
    return Number.isFinite(value) && value >= 0 ? value : item.estimatedCost;
  }

  async function saveCost(item: Part) {
    const value = costFor(item);
    if (persistent) {
      try {
        await runAction({ type: "updatePrice", code: item.code, price: value });
        setSaveError("");
      } catch (error) {
        setSaveError(
          error instanceof Error
            ? error.message
            : "Não foi possível salvar o preço.",
        );
      }
      return;
    }
    setStock((parts) =>
      parts.map((part) =>
        part.code === item.code ? { ...part, estimatedCost: value } : part,
      ),
    );
    setDraftCosts((current) => ({ ...current, [item.code]: String(value) }));
  }

  const warehouses = [
    "Todos",
    ...new Set(purchaseItems.map(({ item }) => item.warehouse)),
  ];
  const visibleItems = purchaseItems
    .filter(
      ({ item, projection }) =>
        (item.name + " " + item.code)
          .toLocaleLowerCase("pt-BR")
          .includes(search.toLocaleLowerCase("pt-BR")) &&
        (warehouse === "Todos" || item.warehouse === warehouse) &&
        (risk === "Todos" ||
          (risk === "Risco de ruptura") === projection.arrival < 0),
    )
    .sort((a, b) =>
      order === "cost"
        ? costFor(b.item) * b.projection.buy -
          costFor(a.item) * a.projection.buy
        : order === "quantity"
          ? b.projection.buy - a.projection.buy
          : order === "name"
            ? a.item.name.localeCompare(b.item.name, "pt-BR")
            : a.projection.arrival - b.projection.arrival,
    );
  const investment = visibleItems.reduce(
    (sum, { item, projection }) => sum + costFor(item) * projection.buy,
    0,
  );
  const ruptureCount = visibleItems.filter(
    ({ projection }) => projection.arrival < 0,
  ).length;
  const emptyCount = visibleItems.filter(
    ({ item }) => item.quantity <= 0,
  ).length;
  const criticalCount = visibleItems.filter(
    ({ item }) => item.quantity > 0 && item.quantity < item.minimum,
  ).length;

  function exportCsv() {
    const rows = [
      [
        "Peça",
        "ID",
        "Almoxarifado",
        "Saldo",
        "Consumo em 30 dias",
        "Prazo (dias)",
        "Saldo na chegada",
        "Compra sugerida",
        "Valor unitário (R$)",
        "Investimento (R$)",
      ],
      ...visibleItems.map(({ item, projection }) => [
        item.name,
        item.code,
        item.warehouse,
        item.quantity,
        item.consumed30,
        item.leadDays,
        projection.arrival,
        projection.buy,
        costFor(item),
        projection.buy * costFor(item),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((value) => JSON.stringify(String(value))).join(";"))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "marcon-compra-preditiva.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {heading(
        "PLANEJAMENTO",
        "Compra preditiva",
        "Projeção de reposição de peças baseada no consumo e no prazo de fornecimento.",
      )}
      {saveError && (
        <div className="info" role="alert">
          {saveError}
        </div>
      )}
      <p
        className={
          "purchase-intro " + (ruptureCount ? "needs-attention" : "is-healthy")
        }
      >
        {ruptureCount
          ? `▲ ${ruptureCount} peças podem faltar antes da próxima entrega.`
          : "✓ Nenhuma peça com ruptura prevista neste recorte."}{" "}
        Toque em uma peça para entender a sugestão.
      </p>
      <details
        className="panel purchase-filters"
        aria-label="Filtros de compra preditiva"
      >
        <summary>Buscar e filtrar peças</summary>
        <div className="panel-head">
          <div>
            <h2>Priorizar compras</h2>
            <p>Encontre peças em risco e compare a previsão de investimento.</p>
          </div>
          <button
            className="button secondary"
            type="button"
            onClick={exportCsv}
            disabled={visibleItems.length === 0}
          >
            <Download size={16} aria-hidden="true" /> Exportar planilha
          </button>
        </div>
        <div className="filter-grid">
          <label>
            Peça ou ID
            <div className="purchase-search">
              <Search size={17} aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar peça"
              />
            </div>
          </label>
          <label>
            Almoxarifado
            <select
              value={warehouse}
              onChange={(event) => setWarehouse(event.target.value)}
            >
              {warehouses.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Risco
            <select
              value={risk}
              onChange={(event) => setRisk(event.target.value)}
            >
              <option>Todos</option>
              <option>Risco de ruptura</option>
              <option>Reposição sugerida</option>
            </select>
          </label>
          <label>
            Organizar
            <select
              value={order}
              onChange={(event) => setOrder(event.target.value)}
            >
              <option value="risk">Maior risco primeiro</option>
              <option value="cost">Maior investimento</option>
              <option value="quantity">Maior compra sugerida</option>
              <option value="name">Nome A–Z</option>
            </select>
          </label>
        </div>
      </details>
      <div className="prediction-summary">
        <div className="stat">
          <span>Peças com compra sugerida</span>
          <strong>{visibleItems.length}</strong>
          <small>No recorte atual</small>
        </div>
        <div className="stat">
          <span>Em risco de ruptura</span>
          <strong>{ruptureCount}</strong>
          <small>Saldo projetado negativo na chegada</small>
        </div>
        <div className="stat">
          <span>Investimento estimado</span>
          <strong>{currency(investment)}</strong>
          <small>Valores editáveis desta sessão</small>
        </div>
      </div>
      <section
        className="panel purchase-visual-summary"
        aria-label="Panorama das compras sugeridas"
      >
        <div className="panel-head">
          <div>
            <h2>Onde agir primeiro</h2>
            <p>Estado do saldo atual das peças no recorte filtrado.</p>
          </div>
        </div>
        <div className="purchase-status-strip">
          {emptyCount > 0 && (
            <span className="empty" style={{ flex: emptyCount }} />
          )}
          {criticalCount > 0 && (
            <span className="critical" style={{ flex: criticalCount }} />
          )}
          {visibleItems.length - emptyCount - criticalCount > 0 && (
            <span
              className="ok"
              style={{
                flex: Math.max(
                  0,
                  visibleItems.length - emptyCount - criticalCount,
                ),
              }}
            />
          )}
        </div>
        <div className="purchase-status-legend">
          {emptyCount > 0 && (
            <span>
              <i className="empty" />
              Estoque vazio: {emptyCount}
            </span>
          )}
          {criticalCount > 0 && (
            <span>
              <i className="critical" />
              Crítico: {criticalCount}
            </span>
          )}
          {visibleItems.length - emptyCount - criticalCount > 0 && (
            <span>
              <i className="ok" />
              Acompanhar:{" "}
              {Math.max(0, visibleItems.length - emptyCount - criticalCount)}
            </span>
          )}
        </div>
      </section>
      {visibleItems.length ? (
        <div className="stock-grid">
          {visibleItems.map(({ item, projection }) => (
            <article className="panel stock-card" key={item.code}>
              <div className="card-line">
                <span
                  className={
                    "stock-state " +
                    (item.quantity <= 0
                      ? "empty"
                      : item.quantity < item.minimum
                        ? "critical"
                        : "ok")
                  }
                >
                  {item.quantity <= 0
                    ? "Estoque vazio"
                    : item.quantity < item.minimum
                      ? "Crítico"
                      : "Acompanhar"}
                </span>
                <small>{item.code}</small>
              </div>
              <h2>{item.name}</h2>
              <p className="purchase-card-location">{item.warehouse}</p>
              <div className="purchase-card-key">
                <div>
                  <small>Comprar</small>
                  <strong>{projection.buy} un.</strong>
                </div>
                <div>
                  <small>Consumo médio</small>
                  <strong>
                    {(item.consumed30 / 30).toLocaleString("pt-BR", {
                      maximumFractionDigits: 1,
                    })}
                    /dia
                  </strong>
                </div>
              </div>
              <p
                className={
                  projection.arrival < 0
                    ? "purchase-risk is-alert"
                    : "purchase-risk"
                }
              >
                {projection.arrival < 0
                  ? "▲ Pode faltar antes da entrega"
                  : "Reposição planejada"}
              </p>
              <button
                className="button secondary"
                type="button"
                onClick={() => setSelected({ item, projection })}
              >
                Ver detalhes da previsão
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel empty">
          <h3>Nenhuma compra no recorte</h3>
          <p>Altere os filtros para ver outras sugestões.</p>
          <button
            className="button secondary"
            onClick={() => {
              setSearch("");
              setWarehouse("Todos");
              setRisk("Todos");
            }}
          >
            Limpar filtros
          </button>
        </div>
      )}
      <DashboardDialog
        open={!!selected}
        title={
          selected
            ? `Compra preditiva · ${selected.item.name}`
            : "Compra preditiva"
        }
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="purchase-detail">
            <p>
              <strong>{selected.item.code}</strong> · {selected.item.warehouse}
            </p>
            <div className="purchase-detail-grid">
              <div>
                <span>Saldo atual</span>
                <strong>{selected.item.quantity}</strong>
                <small>Mínimo cadastrado: {selected.item.minimum}</small>
              </div>
              <div>
                <span>Consumo médio</span>
                <strong>
                  {(selected.item.consumed30 / 30).toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })}
                  /dia
                </strong>
                <small>
                  {selected.item.consumed30} unidades nos últimos 30 dias
                </small>
              </div>
              <div>
                <span>Compra sugerida</span>
                <strong>{selected.projection.buy}</strong>
                <small>
                  Variação de consumo: {selected.projection.growth}%
                </small>
              </div>
              <div>
                <span>Prazo do fornecedor</span>
                <strong>{selected.item.leadDays} dias</strong>
                <small>
                  Saldo projetado na chegada: {selected.projection.arrival}
                </small>
              </div>
            </div>
            <p>
              Investimento estimado:{" "}
              <strong>
                {currency(selected.projection.buy * costFor(selected.item))}
              </strong>
              . O valor unitário é uma referência interna.
            </p>
            <label className="purchase-cost">
              Valor de referência unitária (R$)
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={
                  draftCosts[selected.item.code] ??
                  String(selected.item.estimatedCost)
                }
                onChange={(event) =>
                  setDraftCosts((current) => ({
                    ...current,
                    [selected.item.code]: event.target.value,
                  }))
                }
                onBlur={() => saveCost(selected.item)}
                aria-label={
                  "Valor de referência unitária de " + selected.item.name
                }
              />
            </label>
            <p>
              Consumo observado: {selected.item.consumed30} unidades nos últimos
              30 dias. Mínimo: {selected.item.minimum} unidades.
            </p>
            <p>
              A projeção usa consumo recente e prazo cadastrado. Confirme
              estoque físico, prazo e cotação antes de comprar.
            </p>
          </div>
        )}
      </DashboardDialog>
    </>
  );
}

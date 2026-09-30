"use client";

import { useState } from "react";
import type { DashboardReport } from "@/lib/dashboard-report";
import type { Role } from "@/lib/workspace-routes";
import { can } from "@/lib/permissions";
import { DashboardDialog } from "./dashboard-dialog";
import { DistributionMap } from "./distribution-map";
import { TransferQueue } from "./transfer-queue";

type DecisionCard = DashboardReport["decisions"]["cards"][number];
const money = (value: number | null) =>
  value === null
    ? "Preço não informado"
    : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function RecommendationCards({
  mode = "distribution",
  report,
  role,
  busy,
  onFilter,
  onPage,
  onTransfer,
  onBuy,
  onCritical,
}: {
  mode?: "purchase" | "distribution";
  report: DashboardReport;
  role: Role;
  busy: boolean;
  onFilter: (filter: string) => void;
  onPage: (page: number) => void;
  onTransfer: (transfer: DashboardReport["transfers"][number]) => void;
  onBuy: (code: string, warehouse: string) => void;
  onCritical: () => void;
}) {
  const [selected, setSelected] = useState<DecisionCard | null>(null);
  const d = report.decisions;
  const archived = ["analysis", "history"].includes(d.filter);
  const totalPositions =
    d.riskSummary.empty + d.riskSummary.critical + d.riskSummary.adequate;
  const headline =
    mode === "purchase"
      ? d.riskSummary.empty + d.riskSummary.critical > 0
        ? `▲ ${d.riskSummary.empty + d.riskSummary.critical} posições precisam de atenção.`
        : "✓ Nenhuma posição abaixo do mínimo neste recorte."
      : d.transfers > 0
        ? `${d.transfers} transferências podem aproximar peças dos blocos.`
        : "Não há transferências sugeridas neste recorte.";
  const row = selected?.row;
  const transfer = selected?.transfer;

  return (
    <section
      className="panel ops-panel decision-panel"
      aria-label={
        mode === "purchase" ? "Compras sugeridas" : "Recomendação de estoque"
      }
    >
      <div className="panel-head">
        <div>
          <h2>
            {mode === "purchase"
              ? "Peças para avaliar"
              : "Sugestões de distribuição"}
          </h2>
          <p className="chart-insight">{headline}</p>
        </div>
      </div>

      {mode === "purchase" && (
        <div
          className="purchase-visual-summary"
          aria-label="Estado do estoque no planejamento"
        >
          <div
            className="purchase-status-strip"
            role="img"
            aria-label={`Estoque vazio ${d.riskSummary.empty}; crítico ${d.riskSummary.critical}; adequado ${d.riskSummary.adequate}`}
          >
            {d.riskSummary.empty > 0 && (
              <span className="empty" style={{ flex: d.riskSummary.empty }} />
            )}
            {d.riskSummary.critical > 0 && (
              <span
                className="critical"
                style={{ flex: d.riskSummary.critical }}
              />
            )}
            {d.riskSummary.adequate > 0 && (
              <span className="ok" style={{ flex: d.riskSummary.adequate }} />
            )}
          </div>
          <div className="purchase-status-legend">
            {d.riskSummary.empty > 0 && (
              <span>
                <i className="empty" />
                Vazio {d.riskSummary.empty}
              </span>
            )}
            {d.riskSummary.critical > 0 && (
              <span>
                <i className="critical" />
                Crítico {d.riskSummary.critical}
              </span>
            )}
            {d.riskSummary.adequate > 0 && (
              <span>
                <i className="ok" />
                Adequado {d.riskSummary.adequate}
              </span>
            )}
          </div>
          <small>{totalPositions} posições no recorte selecionado.</small>
        </div>
      )}

      <div className="decision-toolbar">
        <label>
          Mostrar
          <select
            value={d.filter}
            onChange={(event) => onFilter(event.target.value)}
          >
            <option value="action">Ação necessária</option>
            {mode === "distribution" && (
              <option value="transfer">Transferir</option>
            )}
            {mode === "purchase" && <option value="buy">Comprar</option>}
            {mode === "distribution" && (
              <option value="analysis">Em andamento</option>
            )}
            <option value="insufficient">Sem dados suficientes</option>
            {mode === "distribution" && (
              <option value="history">Histórico</option>
            )}
            <option value="all">Todas as posições</option>
          </select>
        </label>
        <details className="decision-extra">
          <summary>Mais informações</summary>
          <div className="decision-totals">
            <button
              onClick={() => onFilter(mode === "purchase" ? "buy" : "transfer")}
            >
              <strong>{mode === "purchase" ? d.purchases : d.transfers}</strong>
              <span>
                {mode === "purchase"
                  ? "Compras sugeridas"
                  : "Transferências sugeridas"}
              </span>
            </button>
            <button onClick={onCritical}>
              <strong>{d.criticalItems}</strong>
              <span>Itens abaixo do mínimo</span>
            </button>
            <button onClick={() => onFilter("action")}>
              <strong>{d.awaitingReview}</strong>
              <span>Sugestões para revisar</span>
            </button>
          </div>
          <p>
            Contagens antes da paginação. Período: {report.methodology.period}.
            Atualizado: {report.generatedAt}. Sugestões não movimentam saldo.
          </p>
          {mode === "distribution" && (
            <p>
              {report.mapVersion
                ? `Mapa publicado #${report.mapVersion}.`
                : "Sem mapa publicado, não há rota automática verificada."}
            </p>
          )}
        </details>
      </div>

      {archived ? (
        <TransferQueue
          key={`${d.filter}:${report.filters.code}:${report.filters.warehouse}:${report.filters.block}:${report.filters.from}:${report.filters.to}`}
          mode={d.filter === "analysis" ? "analysis" : "history"}
          codeFilter={report.filters.code}
          warehouseFilter={report.filters.warehouse}
          blockFilter={report.filters.block}
          from={report.filters.from}
          to={report.filters.to}
        />
      ) : (
        <>
          <div className="decision-grid">
            {d.cards.map((card) => {
              const r = card.row;
              const t = card.transfer;
              const state =
                r.available <= 0
                  ? "empty"
                  : r.available < r.configuredMinimum
                    ? "critical"
                    : "ok";
              const amount = t?.quantity ?? r.buy;
              return (
                <article
                  className="decision-card decision-compact"
                  key={`${card.action}:${r.code}:${r.warehouse}:${t?.from ?? ""}`}
                >
                  <div className="decision-card-top">
                    <span className={`stock-state ${state}`}>
                      {state === "empty"
                        ? "Estoque vazio"
                        : state === "critical"
                          ? "Crítico"
                          : "Adequado"}
                    </span>
                    <small>{r.code}</small>
                  </div>
                  <h3>{r.item}</h3>
                  <p className="decision-card-location">
                    {t ? `${t.from} → ${t.to}` : r.warehouse}
                  </p>
                  <div className="decision-card-numbers">
                    <div>
                      <small>
                        {card.action === "transfer"
                          ? "Transferir"
                          : card.action === "buy"
                            ? "Comprar"
                            : "Sugestão"}
                      </small>
                      <strong>
                        {amount} {r.unit}
                      </strong>
                    </div>
                    <div>
                      <small>Consumo médio</small>
                      <strong>
                        {(
                          r.withdrawals / Math.max(1, r.analysis.days)
                        ).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                        /dia
                      </strong>
                    </div>
                  </div>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setSelected(card)}
                  >
                    Ver detalhes
                  </button>
                  {t && can(role, "stock") && (
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => onTransfer(t)}
                    >
                      Solicitar transferência
                    </button>
                  )}
                  {card.action === "buy" && can(role, "planning") && (
                    <button
                      className="link-button"
                      onClick={() => onBuy(r.code, r.warehouse)}
                    >
                      Revisar e exportar
                    </button>
                  )}
                </article>
              );
            })}
          </div>
          {!d.cards.length && (
            <p className="dashboard-empty">
              Nenhuma sugestão corresponde aos filtros.
            </p>
          )}
          <nav className="head-actions" aria-label="Paginação das sugestões">
            <button
              className="button secondary"
              disabled={d.page <= 1}
              onClick={() => onPage(d.page - 1)}
            >
              Anterior
            </button>
            <span>
              Página {d.page} · {d.total} sugestões
            </span>
            <button
              className="button secondary"
              disabled={d.page * report.filters.pageSize >= d.total}
              onClick={() => onPage(d.page + 1)}
            >
              Próxima
            </button>
          </nav>
        </>
      )}

      <DashboardDialog
        open={!!selected}
        title={row ? `${row.item} · ${row.code}` : "Detalhes da sugestão"}
        onClose={() => setSelected(null)}
      >
        {row && (
          <div className="purchase-detail">
            <p>
              <strong>{row.warehouse}</strong> · {report.methodology.period} ·{" "}
              {report.scope}
            </p>
            <div className="purchase-detail-grid">
              <div>
                <span>Disponível</span>
                <strong>
                  {row.available} {row.unit}
                </strong>
                <small>
                  Físico {row.physical} − reservado {row.reserved}
                </small>
              </div>
              <div>
                <span>Consumo médio</span>
                <strong>
                  {(
                    row.withdrawals / Math.max(1, row.analysis.days)
                  ).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                  /dia
                </strong>
                <small>
                  {row.withdrawals} {row.unit} em {row.analysis.days} dias
                  observáveis
                </small>
              </div>
              <div>
                <span>
                  {transfer ? "Transferência sugerida" : "Compra sugerida"}
                </span>
                <strong>
                  {transfer?.quantity ?? row.buy} {row.unit}
                </strong>
                <small>
                  Alvo: {row.target} {row.unit}
                </small>
              </div>
              <div>
                <span>Prazo de reposição</span>
                <strong>{row.leadDays} dias</strong>
                <small>
                  Consumo previsto: {row.forecast} {row.unit}
                </small>
              </div>
            </div>
            <div className="prediction-visual">
              <strong>Saldo em relação ao alvo</strong>
              <div className="prediction-track">
                <i
                  style={{
                    width: `${Math.max(0, Math.min(100, (100 * row.available) / Math.max(1, row.target)))}%`,
                  }}
                />
              </div>
              <small>
                {row.available} de {row.target} {row.unit}
              </small>
            </div>
            <details>
              <summary>Como foi calculado</summary>
              <dl className="decision-detail-list">
                <dt>Movimentações</dt>
                <dd>
                  Entradas {row.entries}, retiradas {row.withdrawals},
                  devoluções {row.returns} {row.unit}.
                </dd>
                <dt>Estoque</dt>
                <dd>
                  Mínimo cadastrado {row.configuredMinimum}; mínimo sugerido{" "}
                  {row.minimum}; entradas confirmadas {row.incoming};
                  transferência possível {row.transfer} {row.unit}.
                </dd>
                <dt>Item e local</dt>
                <dd>
                  Localização {row.location}. Mínimo total do item{" "}
                  {row.itemMinimum} {row.unit}. Saldo físico {row.physical},
                  reservado {row.reserved}.
                </dd>
                <dt>Compra</dt>
                <dd>
                  Alvo {row.target} − disponível {row.available} − entradas{" "}
                  {row.incoming} − transferências {row.transfer} − pendentes{" "}
                  {row.distribution?.pendingIncoming ?? 0}, limitado a zero ={" "}
                  {row.buy} {row.unit}.
                </dd>
                <dt>Preço e fonte</dt>
                <dd>
                  {money(row.unitPrice)} por {row.unit}. {row.priceLabel}. Data:{" "}
                  {row.priceDate ?? "não registrada"}. Custo estimado:{" "}
                  {money(row.cost)}.
                </dd>
                <dt>Confiança</dt>
                <dd>
                  {row.analysis.confidence}. {row.analysis.method}.{" "}
                  {row.analysis.reason} MAE:{" "}
                  {row.analysis.mae?.toFixed(2) ?? "não validado"}; WAPE:{" "}
                  {row.analysis.wape === null
                    ? "não validado"
                    : `${(row.analysis.wape * 100).toFixed(1)}%`}
                  .
                </dd>
                <dt>Período e atualização</dt>
                <dd>
                  {report.methodology.period} · {report.generatedAt}
                </dd>
                {mode === "distribution" && (
                  <>
                    <dt>Consumo sem acesso mapeado</dt>
                    <dd>
                      {row.distribution?.unmappedConsumption ?? 0} {row.unit}.{" "}
                      {row.distribution?.proximity}
                    </dd>
                  </>
                )}
                {transfer && (
                  <>
                    <dt>Transferência</dt>
                    <dd>
                      {transfer.from} → {transfer.to}: {transfer.quantity}{" "}
                      {row.unit}. {transfer.reason} {transfer.benefit}
                    </dd>
                    <dt>Origem</dt>
                    <dd>
                      Disponível {transfer.evidence.sourceAvailable}, reservado{" "}
                      {transfer.evidence.sourceReserved}, mínimo{" "}
                      {transfer.evidence.sourceMinimum}, alvo{" "}
                      {transfer.evidence.sourceTarget} {row.unit}.
                    </dd>
                    <dt>Destino</dt>
                    <dd>
                      Disponível {transfer.evidence.destinationAvailable},
                      reservado {transfer.evidence.destinationReserved}, alvo{" "}
                      {transfer.evidence.destinationTarget}, entradas{" "}
                      {transfer.evidence.incoming}, pendentes{" "}
                      {transfer.evidence.pendingIncoming} {row.unit}.{" "}
                      {transfer.evidence.proximity}
                    </dd>
                  </>
                )}
                {transfer && (
                  <>
                    <dt>Consumo por bloco</dt>
                    <dd>
                      {transfer.evidence.consumption
                        ?.map(
                          (item) =>
                            `${item.block}: ${item.quantity} ${row.unit}`,
                        )
                        .join("; ") || "Sem retiradas observadas"}
                      .
                    </dd>
                    <dt>Evidência da sugestão</dt>
                    <dd>
                      {transfer.evidence.period.from} a{" "}
                      {transfer.evidence.period.to}; prazo{" "}
                      {transfer.evidence.leadDays} dias; confiança{" "}
                      {transfer.confidence}; previsão{" "}
                      {transfer.evidence.forecast} {row.unit}.
                    </dd>
                  </>
                )}
              </dl>
            </details>
            <small>
              Fonte: {report.methodology.source}. Valores internos não são
              cotação de fornecedor.
            </small>
            {transfer && report.mapVersion && (
              <DistributionMap
                version={report.mapVersion}
                from={transfer.from}
                to={transfer.to}
              />
            )}
            {transfer && can(role, "stock") && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => onTransfer(transfer)}
              >
                Solicitar transferência
              </button>
            )}
            {selected?.action === "buy" && can(role, "planning") && (
              <button
                className="button primary"
                onClick={() => onBuy(row.code, row.warehouse)}
              >
                Revisar compra e exportar
              </button>
            )}
          </div>
        )}
      </DashboardDialog>
    </section>
  );
}

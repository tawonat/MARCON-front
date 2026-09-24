"use client";

import { useMemo, useState } from "react";
import { ArrowRightLeft, ScanLine } from "lucide-react";
import { useDemoStore } from "../demo-store";
import { heading } from "../ui";
import { balanceOf, distributionSuggestions, type DistributionSuggestion } from "@/lib/inventory";

export function RecommendationScreen() {
  const { stock, balances, setBalances, movements, setMovements, requests, transfers, setTransfers, persistent, runAction } = useDemoStore();
  const [selected, setSelected] = useState<DistributionSuggestion | null>(null);
  const [qr, setQr] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const suggestions = useMemo(() => distributionSuggestions(stock, balances, movements, requests), [stock, balances, movements, requests]);
  const needed = suggestions.filter((item) => item.shortage > 0);

  async function transfer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const part = stock.find((item) => item.code === selected.part.code);
    const central = balanceOf(balances, selected.part.code, "Central");
    if (!part || qr.trim().toUpperCase() !== (part.qrCode ?? part.code).toUpperCase()) {
      setMessage("O QR/ID lido não corresponde à peça selecionada."); return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > central || quantity > selected.suggested) {
      setMessage("Informe uma quantidade inteira dentro do saldo central e da necessidade do destino."); return;
    }
    if (persistent) {
      try {
        await runAction({ type: "transfer", code: part.code, to: selected.to, quantity, qrCode: qr.trim().toUpperCase() });
        setSelected(null); setQr(""); setQuantity(1);
        setMessage(`${quantity} unidade(s) de ${part.name} transferida(s) para ${selected.to}.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível transferir as peças.");
      }
      return;
    }
    const id = Date.now();
    const date = new Date().toISOString().slice(0, 10);
    setBalances((rows) => {
      const next = rows.map((row) => row.partCode === part.code && row.warehouse === "Central"
        ? { ...row, quantity: row.quantity - quantity }
        : row.partCode === part.code && row.warehouse === selected.to
          ? { ...row, quantity: row.quantity + quantity } : row);
      if (!rows.some((row) => row.partCode === part.code && row.warehouse === selected.to))
        next.push({ partCode: part.code, warehouse: selected.to, quantity });
      return next;
    });
    setTransfers((rows) => [{ id, partCode: part.code, from: "Central", to: selected.to, quantity, date, qrCode: qr.trim().toUpperCase() }, ...rows]);
    setMovements((rows) => [
      { id: id + 1, partCode: part.code, type: "saida", quantity, date, warehouse: "Central", transferId: id },
      { id: id + 2, partCode: part.code, type: "entrada", quantity, date, warehouse: selected.to, transferId: id },
      ...rows,
    ]);
    setSelected(null); setQr(""); setQuantity(1);
    setMessage(`${quantity} unidade(s) de ${part.name} transferida(s) para ${selected.to}.`);
  }

  return <>
    {heading("PLANEJAMENTO", "Recomendação de estoque", "Distribua peças do Central aos almoxarifados dos blocos conforme consumo e pedidos em aberto.")}
    <div className="info"><strong>Como a sugestão é calculada</strong><p>O alvo de cada bloco considera retiradas registradas, pedidos em aberto e estoque mínimo. As necessidades mais altas recebem prioridade; uma reserva permanece no Central. Confirme a coleta lendo o QR/ID da embalagem.</p></div>
    <div className="stats"><div className="stat"><span>Destinos com necessidade</span><strong>{needed.length}</strong></div><div className="stat"><span>Unidades sugeridas</span><strong>{needed.reduce((sum, row) => sum + row.suggested, 0)}</strong></div><div className="stat"><span>Transferências registradas</span><strong>{transfers.length}</strong></div></div>
    {message && <div className="info" role="status">{message}</div>}
    <section className="panel"><div className="panel-head"><div><h2>Distribuição recomendada</h2><p>Ordenada pela demanda observada e pelos pedidos em aberto.</p></div></div>
      <div className="recommendation-list">{needed.length ? needed.map((row) => <article className="recommendation-card" key={`${row.part.code}-${row.to}`}>
        <div><strong>{row.part.name}</strong><small>{row.part.code} · Central → {row.to}</small></div>
        <div className="recommendation-metrics"><span>Consumo registrado <strong>{row.demand}</strong></span><span>Pedidos abertos <strong>{row.open}</strong></span><span>Saldo no destino <strong>{row.current}</strong></span><span>Meta <strong>{row.target}</strong></span></div>
        <div className="metric-track"><i className="entry" style={{ width: `${Math.min(100, row.current / row.target * 100)}%` }} /></div>
        <div className="recommendation-action"><span>{row.suggested ? `Enviar ${row.suggested} un. · Central: ${row.available}` : `Central insuficiente · faltam ${row.shortage} un.`}</span><button className="button primary" disabled={!row.suggested} onClick={() => { setSelected(row); setQuantity(row.suggested); setQr(""); setMessage(""); }}><ArrowRightLeft size={16} /> Vou retirar</button></div>
      </article>) : <div className="empty"><h3>Distribuição equilibrada</h3><p>Nenhuma reposição pendente para os blocos.</p></div>}</div>
    </section>
    {selected && <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelected(null)}><form className="detail-modal transfer-modal" role="dialog" aria-modal="true" aria-label="Confirmar transferência" onMouseDown={(event) => event.stopPropagation()} onSubmit={transfer}>
      <h2>Confirmar retirada</h2><p>{selected.part.name} · Central → {selected.to}</p>
      <label>Leia o QR Code ou digite o ID da embalagem<input autoFocus value={qr} onChange={(event) => setQr(event.target.value)} placeholder={selected.part.qrCode ?? selected.part.code} required /><small><ScanLine size={14} /> Leitores que funcionam como teclado podem preencher este campo.</small></label>
      <label>Quantidade<input type="number" min="1" max={selected.suggested} step="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} required /></label>
      <div className="form-actions"><button type="button" className="button secondary" onClick={() => setSelected(null)}>Cancelar</button><button type="submit" className="button primary">Confirmar transferência</button></div>
    </form></div>}
  </>;
}

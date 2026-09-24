import { heading, badge } from "../ui";
import type { Part } from "@/lib/demo-data";
export function RecommendationScreen({ stock }: { stock: Part[] }) {
  return (
    <>
      {heading(
        "PLANEJAMENTO",
        "Recomendação de estoque",
        "Compare saldos atuais com os mínimos recomendados.",
      )}
      <div className="info">
        <strong>Distribuição e separação</strong>
        <p>
          A rota entre almoxarifados (Dijkstra) e a ordem de coleta nas
          prateleiras (TSP) dependem do mapa de conexões, distâncias e posições
          reais. Esta interface exibirá os resultados quando esses dados forem
          integrados.
        </p>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Visão dos materiais</h2>
            <p>Estado atual de cada item.</p>
          </div>
        </div>
        {stock.map((item) => (
          <div className="inventory-row" key={item.name}>
            <div>
              <strong>{item.name}</strong>
              <small>
                {item.quantity} de {item.minimum} unidades mínimas
              </small>
            </div>
            <div className="track">
              <div
                style={{
                  width:
                    Math.min(100, (item.quantity / item.minimum) * 100) + "%",
                  background:
                    item.quantity < item.minimum
                      ? "var(--coral)"
                      : "var(--green)",
                }}
              />
            </div>
            {badge(item.quantity < item.minimum ? "Repor" : "Adequado")}
          </div>
        ))}
      </section>
    </>
  );
}

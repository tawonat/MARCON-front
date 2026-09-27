"use client";
import { useState } from "react";
import type { FacilityGraph, Path } from "@/lib/routing";
export function DistributionMap({ version }: { version: number | null }) {
  const [graph, setGraph] = useState<FacilityGraph | null>(null),
    [route, setRoute] = useState<Path | null>(null),
    [message, setMessage] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  async function load() {
    try {
      const r = await fetch("/api/maps"),
        body = await r.json();
      if (!r.ok) throw Error(body.error);
      const m = body.maps.find((m: { id: number }) => Number(m.id) === version);
      if (!m) throw Error("Mapa indisponível. Atualize o relatório.");
      setGraph(typeof m.graph === "string" ? JSON.parse(m.graph) : m.graph);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha ao carregar mapa.");
    }
  }
  if (!version)
    return (
      <p>
        Rota indisponível: nenhum mapa válido publicado. A operação manual
        continua disponível.
      </p>
    );
  return (
    <div>
      {!graph ? (
        <button className="button secondary" onClick={() => void load()}>
          Abrir planta publicada
        </button>
      ) : (
        <>
          <div className="ops-form">
            <label>
              Origem
              <select value={start} onChange={(e) => setStart(e.target.value)}>
                <option value="">Selecione</option>
                {graph.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Destino
              <select value={end} onChange={(e) => setEnd(e.target.value)}>
                <option value="">Selecione</option>
                {graph.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button secondary"
              disabled={!start || !end}
              onClick={async () => {
                try {
                  const r = await fetch("/api/maps", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "test",
                        start,
                        stops: [end],
                      }),
                    }),
                    data = await r.json();
                  if (!r.ok) throw Error(data.error);
                  setRoute(data.route);
                  setMessage(data.reason);
                } catch (e) {
                  setMessage(
                    e instanceof Error ? e.message : "Falha ao calcular.",
                  );
                }
              }}
            >
              Calcular caminho
            </button>
          </div>
          <svg
            className="ops-map"
            viewBox="0 0 1000 700"
            role="img"
            aria-label="Planta publicada e percurso"
          >
            <image
              href={"/api/maps?image=" + version}
              width="1000"
              height="700"
              preserveAspectRatio="none"
            />
            {route && (
              <polyline
                points={route.nodes
                  .map((id) => {
                    const n = graph.nodes.find((n) => n.id === id)!;
                    return `${n.x * 1000},${n.y * 700}`;
                  })
                  .join(" ")}
                fill="none"
                stroke="var(--blue)"
                strokeWidth="6"
              />
            )}
          </svg>
          {route && (
            <p>
              {route.nodes
                .map((id) => graph.nodes.find((n) => n.id === id)?.label)
                .join(" → ")}{" "}
              · {Math.ceil(route.cost)} s estimados.
            </p>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
      <p>
        Consulta sem alteração de saldo. Validade depende dos caminhos
        conferidos no mapa.
      </p>
    </div>
  );
}

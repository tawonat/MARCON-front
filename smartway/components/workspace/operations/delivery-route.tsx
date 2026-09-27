"use client";
import { useEffect, useState } from "react";
import type { Request } from "@/lib/demo-data";
import {
  planStops,
  shortestPath,
  type FacilityGraph,
  type Path,
} from "@/lib/routing";
export function DeliveryRoute({ request }: { request: Request }) {
  const [data, setData] = useState<{
      id: number;
      graph: FacilityGraph;
      route: Path | null;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/maps", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        const map = body.maps.find(
          (m: { status: string }) => m.status === "Publicada",
        );
        if (!map)
          throw new Error(
            "Rota indisponível: nenhum mapa publicado. Continue a separação manual.",
          );
        const graph: FacilityGraph =
          typeof map.graph === "string" ? JSON.parse(map.graph) : map.graph;
        const ids = (request.allocations ?? []).map(
          (a) =>
            a.nodeId ||
            graph.nodes.find(
              (n) =>
                n.warehouseId ===
                body.warehouses.find(
                  (w: { name: string }) => w.name === a.warehouse,
                )?.id,
            )?.id,
        );
        const blockId = body.blocks.find(
          (b: { name: string }) => b.name === request.block,
        )?.id;
        const end =
          graph.nodes.find(
            (n) => n.blockId === blockId && n.kind === "delivery",
          ) ?? graph.nodes.find((n) => n.blockId === blockId);
        let route: Path | null = null;
        if (ids.length && ids.every(Boolean) && end) {
          route = planStops(graph, ids[0]!, ids as string[]);
          const tail =
            route && shortestPath(graph, route.nodes.at(-1)!, end.id);
          route =
            route && tail
              ? {
                  nodes: [...route.nodes, ...tail.nodes.slice(1)],
                  cost: route.cost + tail.cost,
                }
              : null;
        }
        setData({ id: map.id, graph, route });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [request]);
  if (error) return <p role="status">{error}</p>;
  if (!data) return <p>Calculando percurso…</p>;
  if (!data.route)
    return (
      <p>
        Rota indisponível: pontos sem ligação transitável. Continue manualmente.
      </p>
    );
  return (
    <details>
      <summary>
        Percurso sugerido · {Math.ceil(data.route.cost)} segundos estimados
      </summary>
      <p>
        {data.route.nodes
          .map((id) => data.graph.nodes.find((n) => n.id === id)?.label)
          .join(" → ")}
      </p>
      <svg
        className="ops-map"
        viewBox="0 0 1000 700"
        role="img"
        aria-label="Percurso pelos caminhos cadastrados"
      >
        <image
          href={"/api/maps?image=" + data.id}
          width="1000"
          height="700"
          preserveAspectRatio="none"
        />
        <polyline
          fill="none"
          stroke="#1559db"
          strokeWidth="6"
          points={data.route.nodes
            .map((id) => {
              const n = data.graph.nodes.find((n) => n.id === id)!;
              return `${n.x * 1000},${n.y * 700}`;
            })
            .join(" ")}
        />
      </svg>
      <p>
        Estimativa de caminhada; não movimenta estoque. Coletas precedem a
        entrega.
      </p>
    </details>
  );
}

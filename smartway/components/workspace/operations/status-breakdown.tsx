"use client";

const colors: Record<string, string> = {
  Pendente: "#d97706",
  "Em análise": "#2563eb",
  Aprovada: "#0d9488",
  "Cancelamento solicitado": "#b45309",
  Entregue: "#15803d",
  Cancelada: "#64748b",
};

export function StatusBreakdown({
  rows,
}: {
  rows: { status: string; quantity: number }[];
}) {
  const sorted = rows
    .filter((row) => row.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity);
  const total = sorted.reduce((sum, row) => sum + row.quantity, 0);
  if (!total)
    return <p className="dashboard-empty">Nenhuma requisição neste período.</p>;

  if (sorted.length > 4) {
    const maximum = sorted[0].quantity;
    return (
      <div
        className="status-bars"
        role="img"
        aria-label={sorted
          .map((row) => `${row.status}: ${row.quantity}`)
          .join("; ")}
      >
        {sorted.map((row) => (
          <div className="status-bar" key={row.status}>
            <span>{row.status}</span>
            <div className="metric-track">
              <i
                style={{
                  width: `${(100 * row.quantity) / maximum}%`,
                  background: colors[row.status] ?? "#2563eb",
                }}
              />
            </div>
            <strong>{row.quantity}</strong>
          </div>
        ))}
      </div>
    );
  }

  const segments = sorted.map((row, index) => {
    const start =
      (sorted.slice(0, index).reduce((sum, entry) => sum + entry.quantity, 0) /
        total) *
      100;
    return `${colors[row.status] ?? "#2563eb"} ${start}% ${start + (row.quantity / total) * 100}%`;
  });
  return (
    <div className="dashboard-donut-layout">
      <div
        className="dashboard-donut"
        style={{ background: `conic-gradient(${segments.join(", ")})` }}
        role="img"
        aria-label={sorted
          .map((row) => `${row.status}: ${row.quantity}`)
          .join("; ")}
      >
        <span>
          <strong>{total}</strong>
          <small>pedidos</small>
        </span>
      </div>
      <ul className="dashboard-donut-legend">
        {sorted.map((row) => (
          <li key={row.status}>
            <i style={{ background: colors[row.status] ?? "#2563eb" }} />
            <span>{row.status}</span>
            <strong>{row.quantity}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

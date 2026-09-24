import type { Part, Request } from "@/lib/demo-data";
import { heading } from "../ui";
import { useDemoStore } from "../demo-store";
export function EmployeeRequestScreen({
  selectedPart,
  setSelectedPart,
  selectedStock,
  requestQuantity,
  setRequestQuantity,
  requestPriority,
  setRequestPriority,
  atypical,
  createRequest,
  addCart,
  checkoutCart,
}: {
  selectedPart: string;
  setSelectedPart: React.Dispatch<React.SetStateAction<string>>;
  selectedStock: Part;
  requestQuantity: number;
  setRequestQuantity: React.Dispatch<React.SetStateAction<number>>;
  requestPriority: Request["priority"];
  setRequestPriority: React.Dispatch<React.SetStateAction<Request["priority"]>>;
  atypical: boolean;
  createRequest: (event: React.FormEvent<HTMLFormElement>) => void;
  addCart: () => void;
  checkoutCart: () => void;
}) {
  const { stock, cart, setCart } = useDemoStore();
  return (
    <>
      {heading(
        "REQUISIÇÕES",
        "Fazer requisição",
        "Selecione a peça por nome ou código, confirme a quantidade e escolha a prioridade.",
      )}
      <form className="panel form" onSubmit={createRequest}>
        <div className="panel-head">
          <div>
            <h2>Catálogo de peças</h2>
            <p>Totem do Bloco A · sessão demonstrativa</p>
          </div>
        </div>
        <div className="form-grid">
          <label>
            Peça / ID
            <select
              name="material"
              value={selectedPart}
              onChange={(event) => setSelectedPart(event.target.value)}
            >
              {stock.map((part) => (
                <option value={part.code} key={part.code}>
                  {part.name} · {part.code}
                </option>
              ))}
            </select>
          </label>
          <div className="catalog-availability">
            <strong>{selectedStock.quantity} unidades disponíveis</strong>
            <small>
              Localização {selectedStock.location} · Código QR{" "}
              {selectedStock.code}
            </small>
          </div>
          <label>
            Quantidade
            <input
              name="quantity"
              type="number"
              min="1"
              max={selectedStock.quantity}
              required
              value={requestQuantity}
              onChange={(event) =>
                setRequestQuantity(Number(event.target.value))
              }
            />
          </label>
          <label>
            Confirme a quantidade
            <input
              name="confirmQuantity"
              type="number"
              min="1"
              required
              placeholder="Digite novamente"
            />
          </label>
          <label>
            Prioridade
            <select
              name="priority"
              value={requestPriority}
              onChange={(event) =>
                setRequestPriority(event.target.value as Request["priority"])
              }
            >
              <option>Leve</option>
              <option>Moderado</option>
              <option>Urgente</option>
            </select>
          </label>
          <label>
            Bloco
            <input value="Bloco A · seu bloco" readOnly />
          </label>
          <label className="wide-field">
            Justificativa {atypical && "(obrigatória para pedido atípico)"}
            <textarea
              name="justification"
              required={atypical}
              placeholder="Descreva o motivo, especialmente para volume alto ou urgência"
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={addCart}>
            Adicionar ao carrinho
          </button>
          <button className="button primary" type="submit">
            Requisitar agora
          </button>
        </div>
      </form>
      {cart.length > 0 && (
        <section className="panel cart-panel">
          <div className="panel-head">
            <div>
              <h2>Carrinho · {cart.length} peça(s)</h2>
              <p>Os itens só serão registrados após a confirmação.</p>
            </div>
            <button className="button primary" onClick={checkoutCart}>
              Confirmar carrinho
            </button>
          </div>
          {cart.map((entry, index) => (
            <div className="staff-row" key={index}>
              <strong>
                {stock.find((part) => part.code === entry.code)?.name} ·{" "}
                {entry.quantity} un.
              </strong>
              <button
                className="link-button danger"
                onClick={() =>
                  setCart((items) => items.filter((_, i) => i !== index))
                }
              >
                Remover
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

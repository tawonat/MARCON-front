"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  initialRequests,
  initialStock,
  initialMovements,
  type Movement,
  type Request,
  type Part,
  type ReturnRecord,
} from "@/lib/demo-data";
import { initialStaff, type StaffUser } from "@/lib/staff-data";
import { initialBalances, type InventoryBalance, type Transfer } from "@/lib/inventory";
import type { WorkspaceSnapshot } from "@/lib/workspace-db";
type CartItem = {
  code: string;
  quantity: number;
  priority: Request["priority"];
  justification: string;
};
type Store = {
  persistent: boolean;
  runAction: (action: Record<string, unknown>) => Promise<Record<string, unknown>>;
  requests: Request[];
  setRequests: React.Dispatch<React.SetStateAction<Request[]>>;
  stock: Part[];
  balances: InventoryBalance[];
  setBalances: React.Dispatch<React.SetStateAction<InventoryBalance[]>>;
  transfers: Transfer[];
  setTransfers: React.Dispatch<React.SetStateAction<Transfer[]>>;
  movements: Movement[];
  setMovements: React.Dispatch<React.SetStateAction<Movement[]>>;
  setStock: React.Dispatch<React.SetStateAction<Part[]>>;
  returns: ReturnRecord[];
  setReturns: React.Dispatch<React.SetStateAction<ReturnRecord[]>>;
  staff: StaffUser[];
  setStaff: React.Dispatch<React.SetStateAction<StaffUser[]>>;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
};
const Context = createContext<Store | null>(null);
export function DemoProvider({ children, persistent = false }: { children: React.ReactNode; persistent?: boolean }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(!persistent);
  const [loadedFor, setLoadedFor] = useState(persistent ? "" : pathname);
  const [loadError, setLoadError] = useState("");
  const [requests, setRequests] = useState(initialRequests);
  const [stock, setStock] = useState(initialStock);
  const [balances, setBalances] = useState(initialBalances);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [movements, setMovements] = useState(initialMovements);
  const [staff, setStaff] = useState(initialStaff);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try {
        const saved = window.sessionStorage.getItem("marcon-employee-cart");
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.every((item) =>
            item && typeof item.code === "string" && Number.isSafeInteger(item.quantity) &&
            item.quantity > 0 && ["Leve", "Moderado", "Urgente"].includes(item.priority) &&
            typeof item.justification === "string"
          )) setCart(parsed as CartItem[]);
        }
      } catch { /* Discard an invalid saved cart. */ }
      setCartLoaded(true);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (cartLoaded) window.sessionStorage.setItem("marcon-employee-cart", JSON.stringify(cart));
  }, [cart, cartLoaded]);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    if (response.status === 401) { setReady(true); setLoadedFor(pathname); return; }
    if (!response.ok) throw new Error("Não foi possível carregar os dados do MySQL.");
    const data: WorkspaceSnapshot = await response.json();
    setRequests(data.requests); setStock(data.stock); setBalances(data.balances);
    setMovements(data.movements); setTransfers(data.transfers); setReturns(data.returns); setStaff(data.staff);
    setReady(true); setLoadedFor(pathname); setLoadError("");
  }, [pathname]);
  useEffect(() => {
    if (!persistent) return;
    const timer = window.setTimeout(() => {
      refresh().catch((error) => { setReady(true); setLoadError(error.message); });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [persistent, refresh, pathname]);
  useEffect(() => {
    if (!persistent) return;
    const update = () => { if (document.visibilityState === "visible") refresh().catch(() => undefined); };
    window.addEventListener("focus", update);
    const interval = window.setInterval(update, 30_000);
    return () => { window.removeEventListener("focus", update); window.clearInterval(interval); };
  }, [persistent, refresh]);
  const runAction = useCallback(async (action: Record<string, unknown>) => {
    if (!persistent) throw new Error("Ação persistente indisponível no modo de demonstração.");
    const response = await fetch("/api/workspace", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "A operação não foi concluída.");
    await refresh();
    return result as Record<string, unknown>;
  }, [persistent, refresh]);
  if (!ready || (persistent && loadedFor !== pathname)) return <div className="app-loading" role="status">Carregando dados do sistema…</div>;
  if (loadError) return <div className="app-loading" role="alert">{loadError} <button onClick={() => refresh().catch((error) => setLoadError(error.message))}>Tentar novamente</button></div>;
  return (
    <Context.Provider
      value={{
        persistent,
        runAction,
        requests,
        setRequests,
        stock,
        balances,
        setBalances,
        transfers,
        setTransfers,
        setStock,
        movements,
        setMovements,
        staff,
        setStaff,
        returns,
        setReturns,
        cart,
        setCart,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useDemoStore() {
  const store = useContext(Context);
  if (!store) throw new Error("DemoProvider missing");
  return store;
}

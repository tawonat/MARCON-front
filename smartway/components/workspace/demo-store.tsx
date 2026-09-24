"use client";
import { createContext, useContext, useState } from "react";
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
type CartItem = {
  code: string;
  quantity: number;
  priority: Request["priority"];
  justification: string;
};
type Store = {
  requests: Request[];
  setRequests: React.Dispatch<React.SetStateAction<Request[]>>;
  stock: Part[];
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
export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [requests, setRequests] = useState(initialRequests);
  const [stock, setStock] = useState(initialStock);
  const [movements, setMovements] = useState(initialMovements);
  const [staff, setStaff] = useState(initialStaff);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  return (
    <Context.Provider
      value={{
        requests,
        setRequests,
        stock,
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

"use client";
import { useEffect, useRef, useState } from "react";
import { costAt, money, today, type Product } from "@/lib/domain";
export default function Suppliers({ token }: { token?: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => { setProducts([]); setId(""); setName(""); setPrice(""); if (token) void request(); return () => active.current?.abort(); }, [token]);
  async function request(action?: unknown) {
    if (!token) return;
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage("");
    try {
      const res = await fetch("/api/suppliers", { method: action ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: action ? JSON.stringify(action) : undefined, signal: controller.signal });
      const data = await res.json(); if (!res.ok) throw Error(data.error || "No se pudo guardar.");
      if (controller.signal.aborted) return;
      setProducts(data.products);
      if (action) { setId(""); setName(""); setPrice(""); setMessage("Producto y costo guardados. Asociá sus publicaciones en Publicaciones."); }
    } catch (e) { if (!controller.signal.aborted) setMessage((e as Error).message); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <>
    <p className="table-note">Cargá el costo en pesos argentinos de una unidad del proveedor y desde qué fecha rige. Podés asociar varias opciones de venta al mismo producto en Publicaciones.</p>
    {message && <p className="notice" role="status">{message}</p>}
    <form className="panel supplier-form" onSubmit={(e) => { e.preventDefault(); void request({ type: "product", id: id || crypto.randomUUID(), name, date, cents: Math.round(Number(price) * 100) }); }}>
      <h2>{id ? "Actualizar producto y costo" : "Nuevo producto del proveedor"}</h2>
      <label>Nombre<input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Costo por unidad (ARS)<input required type="number" min="0.01" max="1000000000" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label>Vigente desde<input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <button className="primary" disabled={!token || busy}>{busy ? "Guardando…" : "Guardar producto y costo"}</button>
      {id && <button type="button" onClick={() => { setId(""); setName(""); setPrice(""); }}>Cancelar edición</button>}
    </form>
    <section className="panel pending"><div className="panel-title"><h2>Productos del proveedor</h2><span>{products.length}</span></div>
      {products.map((p) => <div className="pending-row" key={p.id}><div className="order-text"><strong>{p.name}</strong><p>Costo vigente: {costAt(p, today()) === undefined ? "Sin costo para hoy" : money(costAt(p, today())!)}</p>
        <details><summary>Historial de costos</summary>{p.costs.map((c) => <p key={c.from}>{c.from} · {money(c.cents)}</p>)}</details>
      </div><button disabled={busy} onClick={() => { setId(p.id); setName(p.name); setPrice(String((costAt(p, today()) ?? p.costs.at(-1)?.cents ?? 0) / 100)); setDate(today()); }}>Editar / cambiar costo</button></div>)}
      {!products.length && <p className="empty">Creá tu primer producto del proveedor.</p>}
    </section>
  </>;
}

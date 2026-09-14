"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Package,
  Truck,
  Wallet,
  Tag,
  ArrowUpRight,
  RefreshCw,
  Check,
  Copy,
  Link2,
  Download,
} from "lucide-react";
import {
  sampleState,
  summary,
  today,
  money,
  State,
  emptyState,
  costAt,
  Order,
} from "@/lib/domain";
import { applyCommand, Command, dateSchema } from "@/lib/commands";
const modes = {
  flex: "Flex",
  correo: "Correo Argentino",
  acordar: "Acordar con el comprador",
};
export default function Dashboard({ configured }: { configured: boolean }) {
  const [state, setState] = useState<State>(() =>
    configured ? emptyState() : sampleState(),
  );
  const [tab, setTab] = useState(configured ? "Conexión" : "Despachos");
  const [date, setDate] = useState(today);
  const [message, setMessage] = useState("");
  const [demo, setDemo] = useState(!configured);
  const [token, setToken] = useState<string>();
  const [connected, setConnected] = useState(false);
  const [loaded, setLoaded] = useState(!configured);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<"pay" | Order | null>(null);
  const [dispatchDate, setDispatchDate] = useState(today);
  const dialog = useRef<HTMLDialogElement>(null);
  const [costId, setCostId] = useState("");
  const [costDate, setCostDate] = useState(today);
  const [cost, setCost] = useState("");
  const liveToken = useRef<string | undefined>(undefined);
  const supabase = useMemo(
    () =>
      configured
        ? createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          )
        : null,
    [configured],
  );
  const report = summary(state, date);
  const pending = state.orders.filter((o) => !o.dispatchedDate && !o.cancelled);
  const paid = new Set(state.settlements.flatMap((s) => s.orderIds));
  const issues = state.orders.filter((o) => o.review);
  const late = state.orders.filter(
    (o) => o.dispatchedDate && o.dispatchedDate < date && !paid.has(o.id),
  );
  const units = report.orders.reduce(
    (s, o) => s + o.lines.reduce((n, l) => n + l.quantity, 0),
    0,
  );
  const ready = !busy && (demo || (!!token && loaded));
  const canPay =
    ready &&
    !!report.orders.length &&
    !report.missing.length &&
    !report.orders.some((o) => o.review || o.cancelled);
  async function api(path: string, body?: unknown, access = token) {
    if (!access) throw Error("Iniciá sesión para continuar.");
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw Error(data.error || "No se pudo completar la operación.");
    return data;
  }
  async function load(access: string) {
    setLoaded(false);
    setState(emptyState());
    try {
      const data = await api("/api/state", undefined, access);
      if (liveToken.current !== access) return;
      setState(data.state);
      setConnected(data.connected);
      setLoaded(true);
    } catch (e) {
      if (liveToken.current === access) setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      liveToken.current = session?.access_token;
      setToken(session?.access_token);
      if (session) {
        setDemo(false);
        void load(session.access_token);
      } else {
        setState(emptyState());
        setDemo(false);
        setLoaded(false);
        setConnected(false);
        setTab("Conexión");
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase]);
  useEffect(() => {
    const result = new URLSearchParams(location.search).get("connection");
    if (result) {
      setTab("Conexión");
      setMessage(
        result === "ok"
          ? "Mercado Libre conectado. Ya podés actualizar tus ventas."
          : "No se pudo completar la autorización. Volvé a conectar.",
      );
      history.replaceState(null, "", "/");
    }
  }, []);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  const current = useRef({ state, date });
  current.current = { state, date };
  useEffect(() => {
    type Context = {
      registerTool: (
        tool: {
          name: string;
          title: string;
          description: string;
          inputSchema: object;
          annotations: object;
          execute: (input: unknown) => unknown;
        },
        options: { signal: AbortSignal },
      ) => unknown;
    };
    const context = (document as Document & { modelContext?: Context })
      .modelContext;
    if (!context) return;
    const controller = new AbortController();
    try {
      Promise.resolve(
        context.registerTool(
          {
            name: "read_dispatch_summary",
            title: "Consultar resumen de despachos",
            description:
              "Lee los despachos sin pagar para una fecha. No modifica pedidos ni registra pagos.",
            inputSchema: {
              type: "object",
              properties: {
                date: { type: "string", description: "YYYY-MM-DD" },
              },
              required: ["date"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute(input) {
              const d = dateSchema.parse((input as { date?: unknown })?.date);
              const s = summary(current.current.state, d);
              return {
                date: d,
                demo,
                orderIds: s.orders.map((o) => o.id),
                rows: s.rows,
                totalCents: s.total,
                missingCosts: s.missing,
              };
            },
          },
          { signal: controller.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => controller.abort();
  }, [demo]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function command(action: Command) {
    const next = demo
      ? applyCommand(state, action)
      : (await api("/api/state", action)).state;
    setState(next);
    setModal(null);
    setMessage(
      action.type === "pay"
        ? "Pago registrado. El detalle quedó guardado en Liquidaciones."
        : action.type === "cost"
          ? "Costo guardado con su fecha de vigencia."
          : "Despacho confirmado. Se agregó a la liquidación de esa fecha.",
    );
  }
  function textReport() {
    return `${demo ? "EJEMPLO — NO ES UNA LIQUIDACIÓN REAL\n" : ""}Despachos del ${date}\n${report.rows.map((r) => `${r.name} x ${r.quantity} = ${money(r.subtotal)}`).join("\n")}\nTotal = ${money(report.total)}`;
  }
  function csv() {
    const cell = (s: string | number) =>
      `"${String(s)
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""')}"`;
    const rows = [
      ["Fecha", "Producto", "Unidades", "Costo unitario ARS", "Subtotal ARS"],
      ...report.rows.map((r) => [
        date,
        r.name,
        r.quantity,
        r.unitCents / 100,
        r.subtotal / 100,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        ["\ufeff" + rows.map((r) => r.map(cell).join(";")).join("\r\n")],
        { type: "text/csv;charset=utf-8;" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${demo ? "EJEMPLO-" : ""}despachos-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const productName = (o: Order) =>
    o.lines
      .map(
        (l) =>
          `${state.products.find((p) => p.id === l.productId)?.name ?? l.productId} × ${l.quantity}`,
      )
      .join(" · ");
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span>
            <Package size={24} />
          </span>
          despachos<span className="brand-dot">.</span>
        </div>
        <div className="workspace">
          MI OPERACIÓN <span>AR</span>
        </div>
        <nav aria-label="Secciones">
          {[
            { name: "Despachos", icon: Truck },
            { name: "Costos", icon: Tag },
            { name: "Liquidaciones", icon: Wallet },
            { name: "Conexión", icon: Link2 },
          ].map(({ name, icon: Icon }) => (
            <button
              className={tab === name ? "active" : ""}
              aria-current={tab === name ? "page" : undefined}
              key={name}
              onClick={() => setTab(name)}
            >
              <Icon size={19} />
              {name}
              {tab === name && <span className="nav-line" />}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <div className="avatar">
            <Package size={20} />
          </div>
          <div>
            Mi negocio<small>Mercado Libre · Argentina</small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <span>
            MI NEGOCIO <span className="slash">/</span>
            {tab}
          </span>
          <span className="pill">
            {demo
              ? "Vista de prueba"
              : connected
                ? "Cuenta conectada"
                : "Conexión pendiente"}
          </span>
        </header>
        <div className="content">
          {demo && (
            <div className="demo">
              <span>
                <strong>Estás viendo datos de ejemplo.</strong> Los cambios de
                prueba se reinician al recargar.
              </span>
              <button onClick={() => setTab("Conexión")}>
                Conectar mi cuenta <ArrowUpRight size={15} />
              </button>
            </div>
          )}
          <div className="title-row">
            <div>
              <div className="eyebrow">CONTROL DIARIO</div>
              <h1>{tab === "Despachos" ? "Cada despacho, en orden." : tab}</h1>
              <p>
                {tab === "Despachos"
                  ? "Revisá qué salió y cuánto tenés que pagarle a tu proveedor."
                  : tab === "Costos"
                    ? "El precio que te cobra tu proveedor por cada unidad vendida."
                    : tab === "Liquidaciones"
                      ? "Tus cierres y pagos, con el detalle guardado."
                      : "Conectá tus ventas para empezar a trabajar con datos reales."}
              </p>
            </div>
            {tab === "Despachos" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  if (demo || !token) {
                    setTab("Conexión");
                    setMessage(
                      "Conectá tu cuenta para importar ventas reales.",
                    );
                    return;
                  }
                  void run(async () => {
                    const data = await api("/api/sync", {});
                    setState(data.state);
                    setMessage(
                      "Ventas y envíos actualizados. Revisá las incidencias antes de cerrar.",
                    );
                  });
                }}
              >
                <RefreshCw size={16} />
                {busy ? "Actualizando…" : "Actualizar despachos"}
              </button>
            )}
          </div>
          {message && (
            <div className="notice" role="status">
              {message}
              <button aria-label="Cerrar aviso" onClick={() => setMessage("")}>
                ×
              </button>
            </div>
          )}
          {tab === "Despachos" && (
            <>
              <div className="toolbar">
                <label>
                  Fecha de despacho
                  <input
                    aria-label="Fecha de despacho"
                    type="date"
                    max={today()}
                    value={date}
                    onChange={(e) => e.target.value && setDate(e.target.value)}
                  />
                </label>
                <span>
                  {state.syncedAt
                    ? `Actualizado: ${new Date(state.syncedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}`
                    : "Horario de Argentina · Corte Flex 13:00"}
                </span>
              </div>
              {state.syncWarning && (
                <p className="warning">{state.syncWarning}</p>
              )}
              {!!late.length && (
                <p className="warning">
                  Hay {late.length} despachos anteriores sin liquidar.{" "}
                  <button
                    onClick={() =>
                      setDate(late.map((o) => o.dispatchedDate!).sort()[0])
                    }
                  >
                    Revisar el más antiguo
                  </button>
                </p>
              )}
              <div className="stats">
                <div className="stat">
                  <span>
                    Despachos por liquidar <Package size={18} />
                  </span>
                  <strong>
                    {String(report.orders.length).padStart(2, "0")}
                  </strong>
                  <small>Pedidos confirmados para esta fecha</small>
                </div>
                <div className="stat">
                  <span>
                    Unidades <Tag size={18} />
                  </span>
                  <strong>{units}</strong>
                  <small>Productos que salieron</small>
                </div>
                <div className="stat">
                  <span>
                    Por confirmar <Truck size={18} />
                  </span>
                  <strong>{String(pending.length).padStart(2, "0")}</strong>
                  <small>Pendientes de todas las fechas</small>
                </div>
              </div>
              <div className="report-grid">
                <section className="panel">
                  <div className="panel-title">
                    <h2>Resumen de productos</h2>
                    <span className="pill">{report.rows.length} productos</span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>PRODUCTO</th>
                          <th>UNIDADES</th>
                          <th>COSTO UNIT.</th>
                          <th>SUBTOTAL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.rows.map((r, i) => (
                          <tr key={r.productId}>
                            <td>
                              <span className="product-icon">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <strong>{r.name}</strong>
                            </td>
                            <td>{r.quantity}</td>
                            <td>{money(r.unitCents)}</td>
                            <td>
                              <strong>{money(r.subtotal)}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!report.rows.length && (
                      <div className="empty">
                        {report.missing.length
                          ? "Completá los costos para calcular esta liquidación."
                          : "No hay productos pendientes de liquidar en esta fecha."}
                      </div>
                    )}
                  </div>
                  <div className="table-note">
                    Solo despachos confirmados que todavía no registraste como
                    pagados.
                  </div>
                </section>
                <section className="total-card">
                  <div className="eyebrow">TU CIERRE DEL DÍA</div>
                  <span>
                    {report.missing.length
                      ? "Subtotal incompleto"
                      : "Total a pagar"}
                  </span>
                  <strong className="grand-total">{money(report.total)}</strong>
                  <p>
                    {report.orders.length} pedidos · {units} unidades
                  </p>
                  <div className="total-divider" />
                  {report.missing.length ? (
                    <p>Faltan costos: {report.missing.join(", ")}</p>
                  ) : (
                    <span className="check-label">
                      <Check size={17} />
                      Costos del proveedor
                    </span>
                  )}
                  <button
                    disabled={!report.orders.length || !!report.missing.length}
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(textReport());
                        setMessage("Resumen copiado.");
                      })
                    }
                  >
                    <Copy size={16} />
                    Copiar resumen
                  </button>
                  <button
                    className="pay"
                    disabled={!canPay}
                    onClick={() => {
                      setMessage("");
                      setModal("pay");
                    }}
                  >
                    Registrar como pagado <ArrowUpRight size={17} />
                  </button>
                  <small>El registro no realiza una transferencia.</small>
                </section>
              </div>
              {!!report.missing.length && (
                <p className="warning">
                  Hay productos sin costo.{" "}
                  <button onClick={() => setTab("Costos")}>
                    Completar costos
                  </button>
                </p>
              )}
              <section className="panel pending">
                <div className="panel-title">
                  <h2>Pendientes de confirmar</h2>
                  <span className="pill amber">
                    {pending.length} pendientes
                  </span>
                </div>
                {pending.map((o) => (
                  <div className="pending-row" key={o.id}>
                    <div className="parcel">
                      <Package size={21} />
                    </div>
                    <div className="order-text">
                      <strong>{productName(o)}</strong>
                      <small>
                        {o.id} · {modes[o.mode]}
                        {o.expectedDate ? ` · Previsto: ${o.expectedDate}` : ""}
                      </small>
                      {o.review && (
                        <small className="review-text">{o.review}</small>
                      )}
                    </div>
                    <button
                      disabled={!ready}
                      onClick={() => {
                        setMessage("");
                        setDispatchDate(o.suggestedDate ?? date);
                        setModal(o);
                      }}
                    >
                      <Check size={16} />
                      Confirmar despacho
                    </button>
                  </div>
                ))}
                {!pending.length && (
                  <div className="empty">
                    No hay pedidos pendientes de confirmar.
                  </div>
                )}
              </section>
              {!!issues.length && (
                <section className="panel pending">
                  <div className="panel-title">
                    <h2>Incidencias para revisar</h2>
                    <span className="pill amber">{issues.length}</span>
                  </div>
                  {issues.map((o) => (
                    <div className="pending-row" key={o.id}>
                      <div>
                        <strong>
                          {o.id} · {productName(o)}
                        </strong>
                        <small>
                          {o.review}
                          {paid.has(o.id)
                            ? " · Ya pagado: requiere acordar un ajuste con el proveedor."
                            : ""}
                        </small>
                      </div>
                    </div>
                  ))}
                </section>
              )}
              <section className="panel pending">
                <div className="panel-title">
                  <h2>Detalle del cierre</h2>
                  <button
                    disabled={!report.rows.length || !!report.missing.length}
                    onClick={csv}
                  >
                    <Download size={15} />
                    Descargar CSV
                  </button>
                </div>
                {report.orders.map((o) => (
                  <div className="pending-row" key={o.id}>
                    <div>
                      <strong>
                        {o.id} · {productName(o)}
                      </strong>
                      <small>
                        {modes[o.mode]} · {o.evidence ?? "Despacho confirmado"}
                      </small>
                    </div>
                  </div>
                ))}
                {!report.orders.length && (
                  <div className="empty">
                    Los pedidos incluidos en la liquidación aparecerán acá.
                  </div>
                )}
              </section>
            </>
          )}
          {tab === "Costos" && (
            <>
              <section className="panel">
                <div className="panel-title">
                  <h2>Productos y costos</h2>
                  <span className="pill">
                    {state.products.length} productos
                  </span>
                </div>
                <p className="table-note">
                  Si la publicación es un pack, cargá el costo del pack
                  completo. Cada variante conserva su propio costo.
                </p>
                {state.products.map((p) => (
                  <div className="pending-row" key={p.id}>
                    <div className="order-text">
                      <strong>{p.name}</strong>
                      <small>{p.id}</small>
                      <details>
                        <summary>Historial de costos</summary>
                        {p.costs.map((c) => (
                          <p key={c.from}>
                            Desde {c.from}: {money(c.cents)}
                          </p>
                        ))}
                      </details>
                    </div>
                    <span>
                      {costAt(p, today()) === undefined
                        ? "Sin costo"
                        : money(costAt(p, today())!)}
                    </span>
                    <button
                      disabled={!ready}
                      onClick={() => {
                        setCostId(p.id);
                        setCostDate(today());
                        setCost(
                          costAt(p, today()) === undefined
                            ? ""
                            : String(costAt(p, today())! / 100),
                        );
                      }}
                    >
                      Editar costo
                    </button>
                  </div>
                ))}
                {!state.products.length && (
                  <div className="empty">
                    Actualizá tus ventas para importar los productos.
                  </div>
                )}
              </section>
              {costId && (
                <section className="panel pending">
                  <div className="panel-title">
                    <h2>
                      Editar:{" "}
                      {state.products.find((p) => p.id === costId)?.name}
                    </h2>
                  </div>
                  <form
                    className="cost-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const amount = Number(cost.replace(",", "."));
                      if (
                        !Number.isFinite(amount) ||
                        amount <= 0 ||
                        !/^\d+([.,]\d{1,2})?$/.test(cost)
                      ) {
                        setMessage(
                          "Ingresá un costo positivo con hasta dos decimales.",
                        );
                        return;
                      }
                      void run(async () => {
                        await command({
                          type: "cost",
                          id: costId,
                          date: costDate,
                          cents: Math.round(amount * 100),
                        });
                        setCostId("");
                      });
                    }}
                  >
                    <label>
                      Costo en pesos
                      <input
                        autoFocus
                        required
                        inputMode="decimal"
                        value={cost}
                        onChange={(e) => setCost(e.target.value)}
                      />
                    </label>
                    <label>
                      Vigente desde
                      <input
                        required
                        type="date"
                        value={costDate}
                        onChange={(e) => setCostDate(e.target.value)}
                      />
                    </label>
                    <p>
                      Se aplica a despachos sin pagar desde esa fecha. Los pagos
                      ya registrados conservan sus importes.
                    </p>
                    <div className="actions">
                      <button type="button" onClick={() => setCostId("")}>
                        Cancelar
                      </button>
                      <button className="primary" disabled={!ready}>
                        Guardar costo
                      </button>
                    </div>
                  </form>
                </section>
              )}
            </>
          )}
          {tab === "Liquidaciones" && (
            <section className="panel">
              <div className="panel-title">
                <h2>Pagos registrados</h2>
                <span className="pill">{state.settlements.length} cierres</span>
              </div>
              {state.settlements.map((s) => (
                <details className="settlement" key={s.id}>
                  <summary>
                    <span>
                      <strong>Despachos del {s.date}</strong>
                      <small>
                        {s.orderIds.length} pedidos · Registrado{" "}
                        {new Date(s.paidAt).toLocaleString("es-AR", {
                          timeZone: "America/Argentina/Buenos_Aires",
                        })}
                        {demo ? " · Ejemplo" : ""}
                      </small>
                    </span>
                    <strong>{money(s.total)}</strong>
                  </summary>
                  <div className="setup">
                    {s.rows.map((r) => (
                      <p key={r.productId}>
                        {r.name} × {r.quantity} · {money(r.unitCents)} c/u ={" "}
                        <strong>{money(r.subtotal)}</strong>
                      </p>
                    ))}
                    <p>Pedidos: {s.orderIds.join(", ")}</p>
                  </div>
                </details>
              ))}
              {!state.settlements.length && (
                <div className="empty">Todavía no registraste pagos.</div>
              )}
            </section>
          )}
          {tab === "Conexión" && (
            <section className="panel">
              <div className="panel-title">
                <h2>Empezá con tus ventas</h2>
              </div>
              <div className="setup">
                <h3>1. Acceso privado</h3>
                {!configured ? (
                  <p>
                    Falta crear y configurar el proyecto de Supabase. La vista
                    de prueba ya está disponible; todavía no guarda datos
                    reales.
                  </p>
                ) : token ? (
                  <>
                    <p>
                      Sesión iniciada.{" "}
                      {loaded
                        ? "Tus datos se guardan en tu cuenta."
                        : "No se cargaron tus datos. Reintentá antes de operar."}
                    </p>
                    <button
                      onClick={() =>
                        void run(async () => {
                          await supabase!.auth.signOut();
                        })
                      }
                    >
                      Cerrar sesión
                    </button>
                    {!loaded && (
                      <button onClick={() => void load(token)}>
                        Reintentar carga
                      </button>
                    )}
                  </>
                ) : (
                  <form
                    className="login"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fields = new FormData(e.currentTarget);
                      void run(async () => {
                        const { error } =
                          await supabase!.auth.signInWithPassword({
                            email: String(fields.get("email")),
                            password: String(fields.get("password")),
                          });
                        if (error)
                          throw Error(
                            "No se pudo iniciar sesión. Revisá el correo y la contraseña.",
                          );
                      });
                    }}
                  >
                    <label>
                      Correo
                      <input
                        type="email"
                        name="email"
                        required
                        autoComplete="username"
                      />
                    </label>
                    <label>
                      Contraseña
                      <input
                        type="password"
                        name="password"
                        required
                        autoComplete="current-password"
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      Ingresar
                    </button>
                    <p>
                      Usá el usuario creado para esta aplicación en Supabase.
                    </p>
                  </form>
                )}
                <h3>2. Mercado Libre</h3>
                <p>
                  {connected
                    ? "Tu cuenta está conectada. La importación consulta ventas y envíos; no modifica publicaciones."
                    : "Necesitamos una aplicación de Mercado Libre para consultar ventas y envíos. Tu aplicación de cobros de Mercado Pago es independiente."}
                </p>
                <button
                  className="primary"
                  disabled={!token || busy}
                  onClick={() =>
                    void run(async () => {
                      const data = await api("/api/meli/connect", {});
                      location.assign(data.url);
                    })
                  }
                >
                  {connected ? "Renovar conexión" : "Conectar Mercado Libre"}
                  <ArrowUpRight size={16} />
                </button>
                <h3>3. Costos del proveedor</h3>
                <p>
                  Después de importar tus ventas, asigná los costos por
                  producto. Los despachos sin costo quedan pendientes de
                  liquidación.
                </p>
                <button
                  disabled={!token || !connected || busy}
                  onClick={() => setTab("Despachos")}
                >
                  Ir a mis despachos
                </button>
                {!token && (
                  <button
                    onClick={() => {
                      setDemo(true);
                      setLoaded(true);
                      setState(sampleState());
                      setTab("Despachos");
                      setMessage(
                        "Vista de ejemplo. Los cambios se reinician al recargar.",
                      );
                    }}
                  >
                    Probar con datos de ejemplo
                  </button>
                )}
              </div>
            </section>
          )}
          <footer>
            <span>Despachos · Tu cierre diario</span>
            <span>
              Flex: lunes a sábado, corte 13:00 · Domingo sin operación
            </span>
          </footer>
        </div>
      </main>
      <dialog
        ref={dialog}
        onCancel={() => setModal(null)}
        onClose={() => setModal(null)}
        aria-labelledby="dialog-title"
      >
        {modal && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await command(
                  modal === "pay"
                    ? { type: "pay", date }
                    : { type: "confirm", id: modal.id, date: dispatchDate },
                );
              });
            }}
          >
            <h2 id="dialog-title">
              {modal === "pay"
                ? "Registrar pago al proveedor"
                : "Confirmar despacho"}
            </h2>
            {modal === "pay" ? (
              <>
                <p>
                  Vas a registrar como pagados{" "}
                  <strong>{report.orders.length} pedidos</strong> del {date} por{" "}
                  <strong>{money(report.total)}</strong>.
                </p>
                <p>
                  Confirmá este registro una vez realizado el pago. No se
                  transfiere dinero desde esta aplicación.
                </p>
              </>
            ) : (
              <>
                <p>
                  {modal.id} · {productName(modal)}
                </p>
                <p>
                  Confirmá cuando el paquete haya sido entregado al correo o al
                  repartidor.
                </p>
                <label>
                  Fecha real del despacho
                  <input
                    required
                    type="date"
                    max={today()}
                    value={dispatchDate}
                    onChange={(e) => setDispatchDate(e.target.value)}
                  />
                </label>
              </>
            )}
            {message && <p role="alert">{message}</p>}
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Cancelar
              </button>
              <button
                className="primary"
                disabled={busy || (modal === "pay" && !canPay)}
              >
                {busy
                  ? "Guardando…"
                  : modal === "pay"
                    ? "Confirmar pago registrado"
                    : "Guardar despacho"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}

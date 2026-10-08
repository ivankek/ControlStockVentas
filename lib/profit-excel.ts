import ExcelJS from "exceljs";
import type { State } from "./domain";
import type { profitRows } from "./profit";
import { listingKey } from "./supplier";
import { FLEX_LABELS } from "./flex-zones";
type Rows = ReturnType<typeof profitRows>;
const amount = (cents: number | undefined, missing = "Pendiente") => cents === undefined ? missing : cents / 100;

// Export the already filtered and sorted grid, preserving shared-shipment amounts.
export async function profitExcel(rows: Rows, state: State) {
  const book = new ExcelJS.Workbook();
  book.creator = "Despachos";
  book.calcProperties.fullCalcOnLoad = true;
  const sheet = book.addWorksheet("Detalle por venta", { views: [{ state: "frozen", ySplit: 1 }] });
  const headings = ["Fecha", "Orden", "Publicación", "Producto", "Destino", "Envío", "Zona Flex", "Bruto", "Recibido", "Proveedor", "Bonificación ML", "Logística", "Neto", "Estado", "Detalle bonificación"];
  const widths = [14, 23, 55, 38, 35, 28, 20, 18, 18, 18, 20, 18, 18, 55, 42];
  sheet.columns = headings.map((header, i) => ({ header, width: widths[i] }));
  for (const row of rows) {
    const titles: string[] = [], products: string[] = [];
    for (const line of row.sale.lines) {
      const [id, variant = "0"] = line.productId.split(":");
      const listing = state.listings?.find((item) => item.id === id);
      titles.push(`${listing?.title ?? line.productId} × ${line.quantity}`);
      const link = state.supplierLinks?.[line.productId] ?? (variant === "0" && listing ? state.supplierLinks?.[listingKey(listing)] : undefined);
      const product = state.supplierProducts?.find((item) => item.id === link?.supplierId);
      products.push(product ? `${product.name} × ${line.quantity * (link?.units ?? 1)}` : "Sin producto asociado");
    }
    const destination = [row.sale.province, row.sale.city, row.sale.neighborhood].filter((value, index, values) => value && values.indexOf(value) === index).join(" · ") || "Sin ubicación";
    const mode = row.sale.shippingCosts?.shippingError && row.sale.shippingCosts.isFlex === null ? "Envío no disponible" : row.sale.mode === "flex" ? "Flex" : row.sale.mode === "correo" ? "Mercado Envíos · correo" : "Acordar con comprador";
    const bonus = row.sale.mode !== "flex" ? "No aplica" : amount(row.bonusEstimate?.cents, "Sin zona / bruto");
    const detail = row.sale.mode !== "flex" ? "" : row.bonusElsewhere ? "Contada en otra orden del envío" : row.manualNet ? "Incluida en recibido manual" : row.bonusUnresolved ? row.bonusReason ?? row.bonusEstimate?.reason ?? "Pendiente" : row.bonusAdded !== 0 ? "Estimada · sumada al recibido" : row.received === undefined ? "Estimada · falta recibido" : "Estimada · ya incluida";
    sheet.addRow([new Date(row.date + "T00:00:00Z"), row.sale.id, titles.join("\n"), products.join("\n"), destination,
      row.sale.cancelled || row.sale.shippingStatus === "cancelled" ? "Cancelado · " + mode : mode,
      row.flex ? row.flex.zone ? FLEX_LABELS[row.flex.zone] : "Zona desconocida" : "",
      amount(row.gross, "A revisar"), amount(row.received), amount(row.supplier), bonus, amount(row.shipping), amount(row.net),
      row.issues.length ? row.issues.join("\n") : "Sin pendientes", detail]);
  }
  sheet.getColumn(1).numFmt = "dd/mm/yyyy";
  sheet.getColumn(2).numFmt = "@";
  for (let col = 8; col <= 13; col++) sheet.getColumn(col).numFmt = '"$" #,##0.00;[Red]-"$" #,##0.00';
  const end = rows.length + 1;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: end, column: headings.length } };
  const averages = sheet.addRow(["PROMEDIO"]);
  for (let col = 8; col <= 13; col++) {
    const values = rows.map((_, i) => sheet.getCell(i + 2, col).value).filter((value): value is number => typeof value === "number");
    const letter = sheet.getColumn(col).letter;
    averages.getCell(col).value = values.length ? {
      formula: `IFERROR(AVERAGE(${letter}2:${letter}${end}),"")`,
      result: values.reduce((sum, value) => sum + value, 0) / values.length,
    } : "Sin datos";
  }
  sheet.eachRow((row, index) => {
    row.alignment = { vertical: "top", wrapText: true };
    row.font = { name: "Calibri", size: 11 };
    if (index === 1 || index === averages.number) {
      row.font = { name: "Calibri", size: 11, bold: true, color: { argb: index === 1 ? "FFFFFFFF" : "FF00443E" } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index === 1 ? "FF00443E" : "FFE7F1ED" } };
      row.height = 28;
    }
  });
  sheet.addRow(["Los promedios consideran solo importes numéricos de las filas exportadas; incluyen ceros y excluyen pendientes y no aplicables."]);
  sheet.mergeCells(sheet.rowCount, 1, sheet.rowCount, headings.length);
  const bytes = await book.xlsx.writeBuffer();
  return new Uint8Array(bytes);
}

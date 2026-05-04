import * as XLSX from "xlsx";

export type ReportHeader = {
  travelerName: string;
  country: string;
  purpose: string;
  fromDate: string;
  toDate: string;
};

export type ReportExpense = {
  date: string;
  merchant: string;
  currency: string;
  amount: number;
  category: string;
  paymentMethod: "company_card" | "employee";
  receiptName: string;
};

export type ExchangeRate = {
  currency: string;
  rateToIls: number;
};

const PAYMENT_LABEL: Record<ReportExpense["paymentMethod"], string> = {
  company_card: "Company Card",
  employee: "Employee",
};

export const DEFAULT_EXCHANGE_RATES: ExchangeRate[] = [
  { currency: "USD", rateToIls: 3.7 },
  { currency: "EUR", rateToIls: 4.0 },
  { currency: "GBP", rateToIls: 4.7 },
  { currency: "JPY", rateToIls: 0.025 },
  { currency: "THB", rateToIls: 0.1 },
  { currency: "CAD", rateToIls: 2.7 },
];

export function downloadExpenseWorkbook(
  header: ReportHeader,
  expenses: ReportExpense[],
  exchangeRates: ExchangeRate[],
) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([]);

  ws["!cols"] = [
    { wch: 4 },
    { wch: 18 },
    { wch: 14 },
    { wch: 26 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
  ];

  // Header fields requested by finance template mapping.
  XLSX.utils.sheet_add_aoa(
    ws,
    [
      ["", "Country", "", "Purpose", "", "From", "To"],
      ["", header.country, "", header.purpose, "", header.fromDate, header.toDate],
    ],
    { origin: "B12" },
  );

  XLSX.utils.sheet_add_aoa(
    ws,
    [["", "Traveler"], ["", header.travelerName]],
    { origin: "B10" },
  );

  // Exchange table H5:I10 drives all ILS calculations.
  XLSX.utils.sheet_add_aoa(
    ws,
    [["Currency", "Rate to ILS"], ...exchangeRates.map((r) => [r.currency, r.rateToIls])],
    { origin: "H4" },
  );

  // Expense table starts at row 28.
  XLSX.utils.sheet_add_aoa(
    ws,
    [["", "", "Date", "Merchant / Description", "Currency", "Amount", "Amount (ILS)", "Paid By", "Receipt"]],
    { origin: "A27" },
  );

  const rows = expenses.map((expense, idx) => {
    const rowNumber = 28 + idx;
    const safeCurrency = (expense.currency || "ILS").toUpperCase();
    return [
      "",
      "",
      expense.date,
      `${expense.category} - ${expense.merchant}`,
      safeCurrency,
      expense.amount,
      {
        t: "n",
        f: `IF(E${rowNumber}="ILS",F${rowNumber},IFERROR(F${rowNumber}*VLOOKUP(E${rowNumber},$H$5:$I$10,2,FALSE),F${rowNumber}))`,
      },
      PAYMENT_LABEL[expense.paymentMethod],
      expense.receiptName,
    ];
  });

  if (rows.length) {
    XLSX.utils.sheet_add_aoa(ws, rows, { origin: "A28" });
  }

  const totalRow = 28 + Math.max(rows.length, 1);
  XLSX.utils.sheet_add_aoa(
    ws,
    [["", "", "", "", "", "Total (ILS)", { t: "n", f: `SUM(G28:G${totalRow - 1})` }]],
    { origin: `A${totalRow}` },
  );

  XLSX.utils.book_append_sheet(wb, ws, "Expense Report");
  const fileSafeCountry = (header.country || "trip").replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "");
  const fileName = `expense-report-${fileSafeCountry || "trip"}.xlsx`;
  XLSX.writeFileXLSX(wb, fileName);
}

import { ReceiptScanner } from "@/components/ReceiptScanner";
import { ScanLine } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-[var(--gradient-subtle)]">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--gradient-brand)] text-primary-foreground shadow-md">
              <ScanLine className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">Doona</h1>
              <p className="text-xs text-muted-foreground">Receipt Scanner</p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Internal tool · Powered by AI
          </span>
        </div>
      </header>

      <main className="px-6 py-10">
        <div className="mx-auto mb-8 max-w-3xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Submit a receipt in seconds
          </h2>
          <p className="mt-3 text-muted-foreground">
            Upload a photo. AI fills the form using only valid company values, then adds a row to the official
            <span className="font-medium"> Trip Expense </span>spreadsheet — receipt image attached.
          </p>
        </div>
        <ReceiptScanner />
      </main>

      <footer className="mt-16 border-t bg-background/60 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Doona · All scans are saved to your configured sheet.
      </footer>
    </div>
  );
};

export default Index;

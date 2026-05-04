import { ReceiptScanner } from "@/components/ReceiptScanner";
import { EmailGate, useWorkerEmail } from "@/components/EmailGate";
import { Button } from "@/components/ui/button";
import { LogOut, ScanLine } from "lucide-react";

const Index = () => {
  const { email, setEmail, clearEmail } = useWorkerEmail();

  if (!email) return <EmailGate onSubmit={setEmail} />;

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
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearEmail}
            >
              <LogOut className="mr-1 h-3 w-3" /> Change email
            </Button>
          </div>
        </div>
      </header>

      <main className="px-6 py-10">
        <div className="mx-auto mb-8 max-w-3xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Your AI trip-expense assistant
          </h2>
          <p className="mt-3 text-muted-foreground">
            Set up a trip once, then drop receipts, review fields, and export a GitHub Pages compatible spreadsheet.
            All processing runs locally in your browser.
          </p>
        </div>
        <ReceiptScanner userEmail={email} />
      </main>

      <footer className="mt-16 border-t bg-background/60 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Doona · All scans are saved to your configured sheet.
      </footer>
    </div>
  );
};

export default Index;

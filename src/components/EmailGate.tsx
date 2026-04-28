import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Mail, ScanLine } from "lucide-react";
import { toast } from "sonner";

const KEY = "doona.workerEmail";

export const useWorkerEmail = () => {
  const [email, setEmailState] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    if (stored) setEmailState(stored);
  }, []);

  const setEmail = (value: string) => {
    localStorage.setItem(KEY, value);
    setEmailState(value);
  };

  const clearEmail = () => {
    localStorage.removeItem(KEY);
    setEmailState(null);
  };

  return { email, setEmail, clearEmail };
};

export const EmailGate = ({ onSubmit }: { onSubmit: (email: string) => void }) => {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Please enter a valid work email address");
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--gradient-subtle)] px-4">
      <Card className="w-full max-w-sm p-7 shadow-[var(--shadow-elegant)]">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--gradient-brand)] text-primary-foreground shadow-md">
            <ScanLine className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Doona</h1>
            <p className="text-xs text-muted-foreground">Receipt Scanner</p>
          </div>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          Enter your email — we'll send your completed expense sheet and
          a folder of all receipt photos there when you're done.
        </p>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Your email</Label>
            <div className="relative mt-1">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="email"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                className="pl-9"
                onKeyDown={(e) => e.key === "Enter" && submit()}
                autoFocus
              />
            </div>
          </div>
          <Button className="w-full" onClick={submit}>
            Continue
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            No password. No sign-up. We just need somewhere to send the report.
          </p>
        </div>
      </Card>
    </div>
  );
};
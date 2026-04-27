import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const AuthPage = () => {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || !password) return toast.error("Enter your work email and password");
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created — check your email to confirm, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e: any) {
      toast.error(e.message || "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
    } catch (e: any) {
      toast.error(e.message || "Google sign-in failed");
      setBusy(false);
    }
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
            <p className="text-xs text-muted-foreground">
              {mode === "signin" ? "Sign in to scan receipts" : "Create your worker account"}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Work email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>
          <div>
            <Label className="text-xs">Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>

          <div className="relative my-2 text-center text-xs text-muted-foreground">
            <span className="bg-card px-2">or</span>
            <div className="absolute left-0 right-0 top-1/2 -z-10 h-px bg-border" />
          </div>

          <Button variant="outline" className="w-full" onClick={google} disabled={busy}>
            Continue with Google
          </Button>

          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin"
              ? "Don't have an account? Create one"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </Card>
    </div>
  );
};

export const useAuthSession = () => {
  const [email, setEmail] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return email;
};

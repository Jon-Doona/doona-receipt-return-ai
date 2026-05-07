// Reuse the provided Deno implementation already used by scan-receipt.
// This keeps behavior identical while exposing it under the expense-assistant endpoint.
import "../scan-receipt/index.ts";

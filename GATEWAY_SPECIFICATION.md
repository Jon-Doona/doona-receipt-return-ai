/**
 * GATEWAY SPECIFICATION FOR RECEIPT SCANNER
 * 
 * This document specifies what the Google Apps Script endpoint should return
 * for the ReceiptScanner.tsx component to work correctly.
 * 
 * TWO-STEP PROCESS:
 * 1. ANALYZE (action: "analyze") - Extract and return fields
 * 2. SAVE (action: "saveExpense") - Write to spreadsheet (no response needed)
 */

/**
 * STEP 1: ANALYZE ACTION
 * 
 * When action: "analyze" is sent with action: "analyze", the Gateway should:
 * 
 * INPUT:
 * {
 *   "action": "analyze",
 *   "image": "<CLEAN_BASE64_STRING>",  // WITHOUT data:image/...;base64, prefix
 *   "target": "ILS"
 * }
 * 
 * PROCESS:
 * 1. Send the Base64 image to the AI (Google Vision API, OpenAI GPT-4V, etc.)
 * 2. Extract the following fields:
 *    - amount: The TOTAL amount from the receipt (number)
 *    - currency: The ISO currency code (CNY, USD, EUR, RMB, etc.)
 *    - description: Merchant name + city (string, max 100 chars)
 *    - date: Receipt date in YYYY-MM-DD format (string)
 *    - category: Category name in Hebrew (string)
 * 
 * CRITICAL: DO NOT SAVE TO SPREADSHEET during analyze phase
 * CRITICAL: Convert CNY to RMB before returning
 * 
 * OUTPUT (success case):
 * {
 *   "extracted": {
 *     "amount": 45.50,              // number (float), NOT string
 *     "currency": "RMB",            // ALREADY NORMALIZED (CNY→RMB)
 *     "description": "Beijing Airport Shop",
 *     "date": "2025-05-06",
 *     "category": "ארוחות",
 *     "merchant": "Airport Shop",
 *     "payment_method": "company_card",
 *     "raw_text": "¥ 45.50 RMB"
 *   }
 * }
 * 
 * OUTPUT (error case):
 * {
 *   "error": "Failed to extract data from image",
 *   "status": "error"
 * }
 * 
 * RESPONSE CODES:
 * - 200 OK: Extraction successful (return extracted data or { extracted: {...} })
 * - 400 Bad Request: Missing imageBase64
 * - 500 Server Error: AI failed or other backend error
 */

/**
 * STEP 2: SAVEEXPENSE ACTION
 * 
 * When action: "saveExpense" is sent AFTER user verifies the data, the Gateway should:
 * 
 * INPUT:
 * {
 *   "action": "saveExpense",
 *   "date": "2025-05-06",
 *   "category": "ארוחות",
 *   "amount": 45.50,             // ILS amount (number)
 *   "currency": "RMB",           // Already normalized
 *   "description": "Beijing Airport Shop",
 *   "destination": "China",      // From trip data
 *   "reason": "Business trip",   // From trip data
 *   "email": "user@company.com",
 *   "startDate": "2025-05-01",
 *   "returnDate": "2025-05-10"
 * }
 * 
 * PROCESS:
 * 1. Write the receipt to the RAW sheet (or appropriate spreadsheet)
 * 2. Use these exact column names/keys:
 *    - date
 *    - category
 *    - amount (as NUMBER, not string)
 *    - currency
 *    - description
 *    - destination
 *    - reason
 *    - email
 *    - startDate
 *    - returnDate
 * 
 * OUTPUT:
 * Can return any response (won't be read due to no-cors mode in frontend)
 * {
 *   "success": true,
 *   "rowNumber": 15
 * }
 * 
 * RESPONSE CODES:
 * - 200 OK: Successfully saved
 * - 400 Bad Request: Missing required fields
 * - 500 Server Error: Failed to write to spreadsheet
 */

/**
 * CURRENCY NORMALIZATION TABLE
 * 
 * The ReceiptScanner expects these currencies:
 * - RMB (0.45 to ILS)
 * - USD (3.44 to ILS)
 * - EUR (3.82 to ILS)
 * 
 * If the AI returns CNY, MUST convert to RMB:
 * {
 *   "currency": "CNY" (from AI)
 * }
 * 
 * Should be returned as:
 * {
 *   "currency": "RMB" (to frontend)
 * }
 * 
 * This prevents VLOOKUP failures in the spreadsheet.
 */

/**
 * VALIDATION CHECKLIST
 * 
 * ✅ analyze action returns extracted data (not error/success message)
 * ✅ analyze action does NOT save to spreadsheet
 * ✅ analyze action returns amount as NUMBER (45.50), not STRING ("45.50")
 * ✅ analyze action normalizes CNY → RMB before returning
 * ✅ analyze action returns date in YYYY-MM-DD format
 * ✅ analyze action returns description/destination (max 100 chars)
 * ✅ saveExpense action receives already-verified data
 * ✅ saveExpense action converts amount to NUMBER before saving
 * ✅ saveExpense action saves to RAW sheet with exact key names
 * ✅ Both actions log errors to console for debugging
 */

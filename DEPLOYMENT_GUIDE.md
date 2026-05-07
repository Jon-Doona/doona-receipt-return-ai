# Receipt Scanner: Google Apps Script + Gemini Deployment Guide

## 🏗 Architecture

```
Browser (React/Vite)
    ↓ POST { action: 'analyze', imageBase64, mimeType }
Google Apps Script (Web App)
    ↓ UrlFetchApp.fetch()
Google Generative Language API (v1beta)
    ↓ Gemini 1.5 Flash Extract receipt data
Google Apps Script
    ↓ Return { extracted: { amount, currency, description, date, category } }
Browser
    ↓ Display results
Google Sheets (RAW tab)
```

## 📋 Setup Checklist

### 1. **Get Gemini API Key**
- Go to [Google AI Studio](https://ai.google.dev/)
- Create a new project or select existing
- Enable the Generative Language API
- Create an API key (not OAuth)
- Copy the key (starts with `AIza...`)

### 2. **Deploy Google Apps Script as Web App**

#### Step 1: Copy the Script
- Go to [Google Apps Script Dashboard](https://script.google.com/)
- Create a new project (name it "Doona Receipt Scanner")
- Copy the entire code from `scripts/runAIVisionAnalysis.gs`
- Paste it into the editor
- **Delete any existing `doPost()` or test functions**

#### Step 2: Save API Key in Script Properties
1. Click **Project Settings** (gear icon bottom left)
2. Click **Script Properties** tab
3. Click **Add script property**
4. **Name:** `GEMINI_API_KEY`
5. **Value:** Paste your API key (e.g., `AIzaSyCSbz9bMK47GPmwx3SmKfvCWdTDd6bjUNg`)
6. Click **Save**

#### Step 3: Deploy as Web App
1. Click **Deploy** (top right)
2. Select **New Deployment**
3. Click the gear icon and select **Web app**
4. Configuration:
   - **Execute as:** Me (your Google account)
   - **Who has access:** Anyone
5. Click **Deploy**
6. **IMPORTANT:** Copy and save the deployment URL (it looks like):
   ```
   https://script.google.com/macros/s/ABCDEF.../usercopy
   ```

### 3. **Update Frontend (Frontend Repository)**

#### Update `src/lib/api.ts`
The hardcoded URL must match your deployed GAS script:
```typescript
export const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
```

**Current value (as of May 7, 2026):**
```typescript
export const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzuq3ynvlbXvApvhe9B-d9yERuGlzegNBmE6tPOKxtZ430qruZL7QwYZh-F-s9bIas/exec";
```

### 4. **Test the Connection**

#### Browser Console Test
1. Open your React app in the browser
2. Open **Developer Tools** (F12)
3. Click **Console** tab
4. Type and press Enter:
```javascript
fetch("https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec", {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: JSON.stringify({ action: 'test' })
}).then(r => r.text()).then(console.log)
```
You should see a response (even if it's an error).

#### Upload a Real Receipt
1. Go to the Receipt Scanner UI
2. Upload a test receipt image
3. Open **Developer Tools > Console**
4. Watch the logs:
   - `🚀 [scanReceipt] Sending POST request...`
   - `📬 [scanReceipt] Response received: 200 OK`
   - `✅ [scanReceipt] SUCCESS: Extracted data received`
5. If you see errors, look for the error logs and copy them below.

## 🐛 Debugging Guide

### Error: `apiKey not found in Script Properties`
**Fix:** Go back to Step 2.2 above and save the API key in Script Properties.

### Error: `HTTP 404 Not Found`
**Cause:** The deployment ID in `api.ts` doesn't match the actual deployment.
**Fix:** 
1. Go to your Apps Script project
2. Click **Deploy > Manage Deployments**
3. Copy the deployment URL
4. Update `src/lib/api.ts` with the correct URL

### Error: `Both primary and fallback model calls failed`
**Cause:** Gemini API call is failing. Check the logs in Google Apps Script.
**Fix:**
1. Go to your Apps Script editor
2. Click **Execution log** (top left)
3. Look for the most recent execution
4. Expand it and look for error messages
5. Common errors:
   - `Quota Exceeded` → API quota used up or billing not enabled
   - `Invalid API Key` → Wrong key in Script Properties
   - `Resource Not Found` → Model name typo

### Error: `Invalid JSON response from GAS`
**Cause:** GAS returned HTML or error page instead of JSON.
**Fix:**
1. Check that the deployment URL is correct
2. Check that the script is actually deployed as a Web App (not editor link)
3. Try accessing the URL in a browser (should return `{"error":"..."}`  or similar)

### Error: `GEMINI_API_KEY not set; using fallback URL`
**Cause:** Vite env var not passed during build.
**Fix:** 
- In GitHub Actions, ensure `VITE_GEMINI_API_KEY` is set as a secret
- Or: set `GEMINI_API_KEY` in Apps Script Properties instead

## 📊 Browser Console Logging

The code includes extensive console logging. When testing, you'll see:

```
✅ [scanReceipt] Base64 cleaned
   Original length: 50000, Clean length: 49950
   First 50 chars: iVBORw0KGgoAAAANSUhEUgAAAAUA...
📦 [scanReceipt] Payload built: 50200 bytes
🚀 [scanReceipt] Sending POST request to Google Apps Script...
📬 [scanReceipt] Response received: 200 OK
✅ [scanReceipt] Parsed result: { extracted: { amount: 45.50, currency: "RMB", description: "Beijing Airport Shop", date: "2025-05-06", category: "ארוחות" } }
🎉 [scanReceipt] SUCCESS: Extracted data received
```

## 🔄 Redeployment

If you update the Google Apps Script code:

1. Edit the script in the Apps Script editor
2. Click **Deploy > Manage Deployments**
3. Click the latest deployment
4. Click **Edit**
5. Update the code (or create a new deployment)
6. Click **Deploy**

**NOTE:** The deployment URL may change. If it does, update `src/lib/api.ts`.

## 📝 Key Code Locations

| File | Purpose |
|------|---------|
| `scripts/runAIVisionAnalysis.gs` | Google Apps Script (doPost handler) |
| `src/lib/api.ts` | Frontend API wrapper with hardcoded GAS URL |
| `src/components/ReceiptScanner.tsx` | React component that calls `scanReceipt()` |

## 🎯 Expected Flow

1. User uploads receipt image in ReceiptScanner.tsx
2. Image converted to Base64 in browser
3. `scanReceipt()` in api.ts sends to GAS
4. GAS `doPost()` receives request
5. GAS calls Gemini 1.5 Flash API with the image
6. Gemini extracts amount, currency, description, date, category
7. GAS returns JSON with extracted data
8. Browser receives response and displays results
9. User can edit and save to spreadsheet

## 🆘 Getting Help

When reporting issues, include:
1. Screenshot of browser console errors
2. The full error message from Google Apps Script execution log
3. Confirmation that:
   - [ ] Gemini API key is valid
   - [ ] API key is saved in Script Properties
   - [ ] Script is deployed as a Web App
   - [ ] Deployment URL matches `api.ts`
   - [ ] You're on GitHub Pages or local dev server

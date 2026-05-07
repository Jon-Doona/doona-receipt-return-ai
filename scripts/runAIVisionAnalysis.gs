/*
  ULTIMATE DEBUGGER: Google Apps Script doPost Handler
  
  Architecture: Browser -> GAS -> Gemini 1.5 Flash (v1beta) -> GAS -> Browser + Sheets
  
  CRITICAL: This script MUST be deployed as a New Deployment (Type: Web app)
  - Execute as: Me (your account)
  - Who has access: Anyone
  
  Setup:
  1. Save your Gemini API key in Script Properties: GEMINI_API_KEY = "AIza..."
  2. Deploy as web app
  3. Frontend calls this endpoint with: { action: 'analyze', imageBase64: 'xxxxx', mimeType: 'image/jpeg' }
*/

function doPost(e) {
  Logger.log("🚀 doPost START: Received request");
  Logger.log("Request params: " + JSON.stringify(e.parameter));
  
  try {
    // 1. VALIDATE API KEY
    var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    Logger.log("API Key loaded: " + (apiKey ? "✅ YES" : "❌ NO"));
    
    if (!apiKey) {
      var errorMsg = "❌ FATAL: GEMINI_API_KEY not found in Script Properties. Go to Extensions > Apps Script > Project Settings > Script Properties and add: GEMINI_API_KEY = your-key";
      Logger.log(errorMsg);
      return contentJson_({ error: errorMsg }, 500);
    }

    // 2. PARSE REQUEST BODY
    var bodyText = (e.postData && e.postData.contents) ? e.postData.contents : null;
    Logger.log("POST body received: " + (bodyText ? "✅ YES (length: " + bodyText.length + ")" : "❌ NO"));
    
    if (!bodyText) {
      return contentJson_({ error: "Missing POST body" }, 400);
    }

    var payload = JSON.parse(bodyText);
    var action = payload.action || 'analyze';
    Logger.log("Action: " + action);

    // 3. ROUTE BY ACTION
    if (action === 'analyze') {
      return handleAnalyzeAction_(payload, apiKey);
    } else if (action === 'saveExpense') {
      return handleSaveExpenseAction_(payload);
    } else {
      return contentJson_({ error: "Unknown action: " + action }, 400);
    }

  } catch (err) {
    var stack = err.stack ? err.stack : "";
    Logger.log("❌ FATAL ERROR in doPost: " + err.toString() + "\nStack: " + stack);
    return contentJson_({ error: "Unhandled error: " + err.toString() }, 500);
  }
}

/**
 * ACTION: analyze — Call Gemini 1.5 Flash to extract receipt data
 */
function handleAnalyzeAction_(payload, apiKey) {
  Logger.log("\n=== ANALYZE ACTION START ===");
  
  try {
    var imageBase64 = payload.imageBase64 || payload.image || null;
    var mimeType = payload.mimeType || 'image/jpeg';
    
    Logger.log("Image Base64 received: " + (imageBase64 ? "✅ YES (length: " + imageBase64.length + ")" : "❌ NO"));
    Logger.log("MIME type: " + mimeType);
    
    if (!imageBase64) {
      return contentJson_({ error: "imageBase64 required in payload" }, 400);
    }

    // 4. BUILD PROPER GEMINI API REQUEST (v1beta format)
    var geminiPrompt = 
      "You are an expert receipt OCR system. Extract the following from the receipt image:\n" +
      "1. TOTAL AMOUNT (the final amount due, including all taxes/fees)\n" +
      "2. CURRENCY (RMB, USD, EUR, or other ISO code)\n" +
      "3. MERCHANT DESCRIPTION (name + city, max 50 chars)\n" +
      "4. DATE (in YYYY-MM-DD format)\n" +
      "5. CATEGORY (in Hebrew)\n\n" +
      "Return ONLY valid JSON with keys: amount, currency, description, date, category";

    var requestPayload = {
      contents: [
        {
          parts: [
            { text: geminiPrompt },
            {
              inlineData: {
                mimeType: mimeType,
                data: imageBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 256
      }
    };

    Logger.log("📦 Gemini request payload built");
    Logger.log("Prompt length: " + geminiPrompt.length);

    // 5. CALL GEMINI API (PRIMARY: v1beta/gemini-1.5-flash-latest)
    var primaryModel = 'gemini-1.5-flash-latest';
    Logger.log("\n🔵 Attempting PRIMARY model: " + primaryModel);
    
    var primaryResp = callGeminiModel_(primaryModel, requestPayload, apiKey);
    
    if (primaryResp.success) {
      Logger.log("✅ PRIMARY model SUCCESS");
      var extracted = extractGeminiResponse_(primaryResp.body);
      Logger.log("Extracted data: " + JSON.stringify(extracted));
      return contentJson_({ extracted: extracted }, 200);
    }

    Logger.log("⚠️  PRIMARY model failed (code: " + primaryResp.code + "). Trying FALLBACK...");
    
    // 6. FALLBACK TO gemini-pro-vision
    var fallbackModel = 'gemini-pro-vision';
    Logger.log("\n🟡 Attempting FALLBACK model: " + fallbackModel);
    
    var fallbackResp = callGeminiModel_(fallbackModel, requestPayload, apiKey);
    
    if (fallbackResp.success) {
      Logger.log("✅ FALLBACK model SUCCESS");
      var extracted = extractGeminiResponse_(fallbackResp.body);
      Logger.log("Extracted data: " + JSON.stringify(extracted));
      return contentJson_({ extracted: extracted }, 200);
    }

    // 7. BOTH FAILED — Return detailed error
    Logger.log("❌ BOTH models failed!");
    Logger.log("Primary error: " + JSON.stringify(primaryResp));
    Logger.log("Fallback error: " + JSON.stringify(fallbackResp));
    
    return contentJson_({
      error: "Gemini API call failed",
      primary: { code: primaryResp.code, error: primaryResp.error },
      fallback: { code: fallbackResp.code, error: fallbackResp.error }
    }, 502);

  } catch (err) {
    Logger.log("❌ ERROR in handleAnalyzeAction_: " + err.toString());
    return contentJson_({ error: "Analyze failed: " + err.toString() }, 500);
  }
}

/**
 * Call Gemini Model via v1beta endpoint
 */
function callGeminiModel_(model, requestPayload, apiKey) {
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(apiKey);
  
  Logger.log("URL: " + url.substring(0, 80) + "...");
  Logger.log("Payload size: " + JSON.stringify(requestPayload).length + " bytes");
  
  var options = {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true,
    timeout: 30
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    var body = response.getContentText();
    
    Logger.log("Response code: " + code);
    Logger.log("Response body (first 500 chars): " + body.substring(0, 500));
    
    if (code >= 200 && code < 300) {
      return { success: true, code: code, body: body };
    } else {
      var errorObj = tryParse_(body);
      Logger.log("Error response: " + JSON.stringify(errorObj));
      return { success: false, code: code, error: errorObj, body: body };
    }
  } catch (err) {
    Logger.log("❌ UrlFetchApp.fetch ERROR: " + err.toString());
    return { success: false, code: 0, error: err.toString(), body: "" };
  }
}

/**
 * Extract structured data from Gemini response
 */
function extractGeminiResponse_(responseBody) {
  try {
    var json = JSON.parse(responseBody);
    var candidates = json.candidates || [];
    
    if (candidates.length === 0) {
      Logger.log("⚠️  No candidates in Gemini response");
      return { error: "No response from Gemini" };
    }

    var candidate = candidates[0];
    var content = candidate.content || {};
    var parts = content.parts || [];
    
    if (parts.length === 0) {
      Logger.log("⚠️  No parts in candidate");
      return { error: "Empty response from Gemini" };
    }

    var text = parts[0].text || "";
    Logger.log("Gemini text response: " + text.substring(0, 200));
    
    // Try to parse the response as JSON
    var extracted = tryParse_(text) || { text: text };
    return extracted;
    
  } catch (err) {
    Logger.log("❌ ERROR parsing Gemini response: " + err.toString());
    return { error: "Failed to parse Gemini response: " + err.toString() };
  }
}

/**
 * ACTION: saveExpense — Write to RAW sheet (not implemented yet, just log)
 */
function handleSaveExpenseAction_(payload) {
  Logger.log("\n=== SAVE EXPENSE ACTION ===");
  Logger.log("Save payload: " + JSON.stringify(payload));
  
  // TODO: Implement actual sheet writing logic
  return contentJson_({ success: true, message: "Save expense logged (not yet implemented)" }, 200);
}

/**
 * UTILITY: Safe JSON parse
 */
function tryParse_(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    Logger.log("⚠️  Could not parse as JSON: " + s.substring(0, 100));
    return null;
  }
}

/**
 * UTILITY: Return JSON response
 */
function contentJson_(obj, code) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

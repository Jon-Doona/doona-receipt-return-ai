/*
Suggested Google Apps Script implementation for runAIVisionAnalysis / doPost.

Notes:
- This implementation expects the web app to be called with POST and JSON body
  containing { action: 'analyze', imageBase64: '<base64 without prefix>', mimeType: 'image/jpeg' }
- It looks for an API key in the query parameter `apiKey` (recommended), or in
  the Script Properties under key `GEMINI_API_KEY` if not provided.
- It calls the v1beta generateContent endpoint with model `gemini-1.5-flash-latest`.
  If that call fails (404 / not found), it retries with fallback model `gemini-pro-vision`.
- You must deploy this Apps Script as a web app (execute as "Me" and allow access)
  and either provide the API key in the deployment URL (?apiKey=...) or save it in
  the Script Properties.
*/

function doPost(e) {
  try {
    var params = (e && e.parameter) || {};
    var apiKey = params.apiKey || PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return contentJson_( { error: 'apiKey required (query param or ScriptProperty GEMINI_API_KEY)' }, 400 );

    var bodyText = e.postData && e.postData.contents ? e.postData.contents : null;
    if (!bodyText) return contentJson_( { error: 'Missing POST body' }, 400 );

    var payload = JSON.parse(bodyText);
    var imageBase64 = payload.imageBase64 || payload.image || payload.image_data || null;
    if (!imageBase64) return contentJson_( { error: 'imageBase64 required' }, 400 );

    // Prepare the prompt for the vision model — adjust as you need.
    var instructions = "Extract the TOTAL AMOUNT, CURRENCY (CNY/USD/EUR), MERCHANT DESCRIPTION, and DATE from the image. Return JSON with fields: amount (number), currency (RMB/USD/EUR/ILS), description (string), date (YYYY-MM-DD), category (Hebrew). Do NOT save to spreadsheet.";

    // Build request body for the Generative Language API
    var requestBody = {
      // For multimodal content, build `input` array containing image + text instruction
      input: [
        { text: instructions },
        { image: { imageBytes: imageBase64 } }
      ],
      temperature: 0,
      maxOutputTokens: 1024
    };

    var baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/';
    var primaryModel = 'gemini-1.5-flash-latest:generateContent';
    var fallbackModel = 'gemini-pro-vision:generateContent';

    function callModel(modelEndpoint) {
      var url = baseUrl + modelEndpoint + '?key=' + encodeURIComponent(apiKey);
      var options = {
        method: 'post',
        contentType: 'application/json; charset=utf-8',
        payload: JSON.stringify(requestBody),
        muteHttpExceptions: true
      };
      var resp = UrlFetchApp.fetch(url, options);
      return { code: resp.getResponseCode(), body: resp.getContentText() };
    }

    // Try primary model first
    var resp = callModel(primaryModel);
    if (resp.code === 404 || resp.code === 400 || resp.code >= 500) {
      // Try fallback
      var fallbackResp = callModel(fallbackModel);
      // If fallback succeeded, return it; otherwise return original error
      if (fallbackResp.code >= 200 && fallbackResp.code < 300) {
        return contentJson_( JSON.parse(fallbackResp.body) );
      } else {
        // Prefer to include both responses for debugging
        return contentJson_( { error: 'Both primary and fallback model calls failed', primary: { code: resp.code, body: tryParse(resp.body) }, fallback: { code: fallbackResp.code, body: tryParse(fallbackResp.body) } }, 502 );
      }
    }

    if (resp.code >= 200 && resp.code < 300) {
      return contentJson_( JSON.parse(resp.body) );
    }

    // Non-success: return the body for debugging
    return contentJson_( { error: 'Model call failed', code: resp.code, body: tryParse(resp.body) }, resp.code );

  } catch (err) {
    return contentJson_( { error: String(err) }, 500 );
  }
}

function tryParse(s) {
  try { return JSON.parse(s); } catch (e) { return s; }
}

function contentJson_(obj, code) {
  var options = {
    status: code || 200,
    headers: { 'Content-Type': 'application/json' }
  };
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

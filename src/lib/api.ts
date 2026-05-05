export async function saveTripHeader(payload: {
  userName: string;
  destination: string;
  startDate: string;
  returnDate: string;
  jobTitle?: string;
}) {
  const url = import.meta.env.VITE_GATEWAY_URL as string;
  if (!url) throw new Error('VITE_GATEWAY_URL is not set');

  const res = await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'saveTripHeader', ...payload }),
  });

  // With no-cors mode, we cannot read the response body
  // Assume success if the request went through (opaque response)
  // The backend will process the data regardless
  return null;
}

export async function saveExpense(payload: {
  date: string;
  category: string;
  amount_ils: string;
  description: string;
  destination: string;
  email: string;
}) {
  const url = import.meta.env.VITE_GATEWAY_URL as string;
  if (!url) throw new Error('VITE_GATEWAY_URL is not set');

  const res = await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'saveExpense', ...payload }),
  });

  // With no-cors mode, we cannot read the response body
  // Assume success if the request went through (opaque response)
  // The backend will process the data regardless
  return null;
}

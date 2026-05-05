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
    mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'saveTripHeader', ...payload }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'saveTripHeader failed');
  }

  // try to parse JSON, but return null if not JSON
  return res.json().catch(() => null);
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
    mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'saveExpense', ...payload }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'saveExpense failed');
  }

  return res.json().catch(() => null);
}

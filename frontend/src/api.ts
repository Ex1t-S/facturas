export type ApiOptions = RequestInit & { form?: FormData };

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    body: options.form ?? options.body,
    headers: options.form ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || response.statusText);
  return data as T;
}

export function postJson<T>(path: string, body: unknown) {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
export const dateFmt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' });


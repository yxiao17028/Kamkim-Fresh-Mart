export async function apiFetch<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    const errMsg = (data as { error?: string })?.error || `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  return data as T;
}

export function formatRM(sen: number): string {
  return `RM ${(sen / 100).toFixed(2)}`;
}

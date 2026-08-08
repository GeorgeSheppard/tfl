const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://api.georgesheppard.dev';

export const customFetch = async <T>(url: string, options: RequestInit): Promise<T> => {
  const response = await fetch(`${BASE_URL}${url}`, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.json() as Promise<T>;
};

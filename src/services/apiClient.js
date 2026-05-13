const DEFAULT_API_BASE_URL = "http://localhost:8080";

export const BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, "");

export async function resolveResponseErrorMessage(response, fallbackMessage) {
  try {
    const payload = await response.clone().json();
    if (typeof payload?.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
  } catch {
    try {
      const text = await response.clone().text();
      if (typeof text === "string" && text.trim()) {
        return text.trim();
      }
    } catch {
      return fallbackMessage;
    }
  }

  return fallbackMessage;
}

export async function throwRequestError(response, fallbackMessage) {
  throw new Error(await resolveResponseErrorMessage(response, fallbackMessage));
}

export class ApiClient {
  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  resolveUrl(path) {
    if (typeof path !== "string" || !path.trim()) {
      return this.baseUrl;
    }

    if (/^https?:\/\//i.test(path)) {
      return path;
    }

    if (path.startsWith("/")) {
      return `${this.baseUrl}${path}`;
    }

    return `${this.baseUrl}/${path}`;
  }

  request(path, options = {}) {
    return fetch(this.resolveUrl(path), options);
  }

  async getJson(path, fallbackMessage, options = {}) {
    const response = await this.request(path, options);

    if (!response.ok) {
      await throwRequestError(response, fallbackMessage || `Request failed (${response.status})`);
    }

    return response.json();
  }

  async postJson(path, body, fallbackMessage, options = {}) {
    const response = await this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await throwRequestError(response, fallbackMessage || `Request failed (${response.status})`);
    }

    return response.json();
  }
}

export const apiClient = new ApiClient();
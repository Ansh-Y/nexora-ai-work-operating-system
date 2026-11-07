const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
let token = "";
let refreshRequest: Promise<boolean> | null = null;
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export const api = {
  setToken(value: string) { token = value; },
  async request(path: string, method = "GET", body?: unknown, canRefresh = true): Promise<any> {
    const formData = typeof FormData !== "undefined" && body instanceof FormData;
    const response = await fetch(`${API_URL}${path}`, { method, credentials: "include", headers: { ...(body && !formData ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? formData ? body : JSON.stringify(body) : undefined, cache: "no-store" });
    if (response.status === 401 && canRefresh && !path.startsWith("/auth/")) {
      if (!refreshRequest) {
        refreshRequest = fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include", cache: "no-store" })
          .then(async result => {
            if (!result.ok) return false;
            const data = await result.json();
            token = data.accessToken;
            if (typeof window !== "undefined") window.sessionStorage.setItem("nexora-token", token);
            return true;
          })
          .catch(() => false)
          .finally(() => { refreshRequest = null; });
      }
      if (await refreshRequest) return this.request(path, method, body, false);
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(Array.isArray(data?.message) ? data.message[0] : data?.message || "Request failed", response.status);
    return data;
  },
  get(path: string) { return this.request(path); },
  post(path: string, body: unknown) { return this.request(path, "POST", body); },
  put(path: string, body: unknown) { return this.request(path, "PUT", body); },
  patch(path: string, body: unknown) { return this.request(path, "PATCH", body); },
  delete(path: string) { return this.request(path, "DELETE"); },
  async download(path: string): Promise<Blob> {
    let response = await fetch(`${API_URL}${path}`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" });
    if (response.status === 401) {
      await this.request("/auth/me");
      response = await fetch(`${API_URL}${path}`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" });
    }
    if (!response.ok) throw new ApiError("Could not download meeting recording", response.status);
    return response.blob();
  },
  async upload(path: string, body: FormData, onProgress?: (percent: number) => void): Promise<any> {
    const send = () => new Promise<{ status: number; data: any }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}${path}`);
      xhr.withCredentials = true;
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100)); };
      xhr.onerror = () => reject(new ApiError("Network error while uploading recording", 0));
      xhr.onload = () => { try { resolve({ status: xhr.status, data: xhr.responseText ? JSON.parse(xhr.responseText) : null }); } catch { resolve({ status: xhr.status, data: null }); } };
      xhr.send(body);
    });
    let result = await send();
    if (result.status === 401) {
      await this.request("/auth/me");
      result = await send();
    }
    if (result.status < 200 || result.status >= 300) throw new ApiError(result.data?.message || "Recording upload failed", result.status);
    return result.data;
  },
};

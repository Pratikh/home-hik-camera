export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function navigate(path: string) {
  // A full document load sends the updated HTTP-only session cookie.
  window.location.assign(path);
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
  } catch {
    throw new ApiError("Backend unavailable", 0);
  }
  if (response.status === 401) {
    navigate("/login");
    throw new ApiError("Authentication failed", 401);
  }
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok) {
    throw new ApiError(typeof body.error === "string" ? body.error : "Backend unavailable", response.status);
  }
  return body as T;
}

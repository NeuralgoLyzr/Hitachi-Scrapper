import { isInIframe } from "@/components/ErrorBoundary";
import { getApiUrl, getAuthToken } from "@/lib/apiClient";

const sendErrorToParent = (
  message: string,
  status?: number,
  endpoint?: string,
) => {
  console.error(`[FetchWrapper] ${message}`, { status, endpoint });

  if (isInIframe()) {
    window.parent.postMessage(
      {
        source: "architect-child-app",
        type: "CHILD_APP_ERROR",
        payload: {
          type: status && status >= 500 ? "api_error" : "network_error",
          message,
          timestamp: new Date().toISOString(),
          url: window.location.href,
          endpoint,
          status,
        },
      },
      "*",
    );
  }
};

const fetchWrapper = async (...args) => {
  try {
    const [input, init] = args as [RequestInfo | URL, RequestInit | undefined]
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const url = rawUrl.startsWith("/api/") ? getApiUrl(rawUrl.replace("/api/", "/api/v1/")) : rawUrl
    const token = getAuthToken()
    const headers = new Headers(init?.headers || {})
    if (token) {
      headers.set("Authorization", `Bearer ${token}`)
    }
    const response = await fetch(url, { ...init, headers });

    // if backend sent a redirect
    if (response.redirected) {
      window.location.href = response.url; // update ui to go to the redirected UI (often /login)
      return;
    }

    if (response.status == 404) {
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("text/html")) {
        const html = await response.text();

        // Replace entire current page with returned HTML
        document.open();
        document.write(html);
        document.close();

        return;
      } else {
        const requestUrl = rawUrl;
        sendErrorToParent(
          `Backend returned 404 Not Found for ${requestUrl}`,
          404,
          requestUrl,
        );
      }
    } // if backend is erroring out
    else if (response.status >= 500) {
      const requestUrl = rawUrl;
      sendErrorToParent(
        `Backend returned ${response.status} error for ${requestUrl}`,
        response.status,
        requestUrl,
      );
    }

    return response;
  } catch (error) {
    // network failures
    const requestUrl = typeof args[0] === "string" ? args[0] : (args[0] as any)?.url || "";
    sendErrorToParent(
      `Network error: Cannot connect to backend (${requestUrl})`,
      undefined,
      requestUrl,
    );
  }
};

export default fetchWrapper;

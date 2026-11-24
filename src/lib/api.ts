import { auth } from './firebase';

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { timeoutMs = 25_000, signal: externalSignal, ...fetchOptions } = options;
  const user = auth.currentUser;
  const headers = new Headers(fetchOptions.headers || {});
  if (!(fetchOptions.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (user) {
    const token = await Promise.race([
      user.getIdToken(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Authentication check timed out. Please try again.')), 10_000)
      ),
    ]);
    headers.set('Authorization', `Bearer ${token}`);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    const res = await fetch(path, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const contentType = res.headers.get('content-type') || '';
      let errorMsg = '';
      if (contentType.includes('application/json')) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        errorMsg = payload?.error || '';
      } else {
        const text = (await res.text().catch(() => '')).trim();
        if (text && !text.startsWith('<') && text.length < 240) {
          errorMsg = text;
        }
      }
      if (!errorMsg) {
        if (res.status === 413) {
          errorMsg = 'The uploaded file is too large for the server request limit. Try a smaller file (under 4 MB on serverless deployments).';
        } else if (res.status === 502 || res.status === 504) {
          errorMsg = 'The server took too long to respond. Please try again.';
        } else {
          errorMsg = res.statusText || `Request failed (${res.status})`;
        }
      }
      throw new Error(errorMsg);
    }

    return (await res.json()) as Promise<T>;
  } catch (err) {
    if (timedOut) {
      throw new Error('Request timed out. Please check your connection and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

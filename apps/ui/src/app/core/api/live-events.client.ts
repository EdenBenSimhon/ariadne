import { Observable } from 'rxjs';
import { eventsUrl, type LiveStreamParams } from './api-urls';
import type { LiveEvent } from './api.types';

/** Data events plus a transport-status signal, carried on one stream. */
export type LiveStreamMessage =
  | LiveEvent
  | { readonly kind: 'status'; readonly status: 'open' | 'error' };

/**
 * SSE as a cold Observable: subscribing opens the `EventSource`, unsubscribing
 * closes it. Transport stays RxJS at the boundary; the component bridges it
 * into signals for zoneless rendering. Transient errors are surfaced as a
 * status message (not `error()`), so the browser's native auto-reconnect keeps
 * working instead of tearing the stream down.
 */
export function liveEvents(params: LiveStreamParams): Observable<LiveStreamMessage> {
  return new Observable<LiveStreamMessage>((subscriber) => {
    const source = new EventSource(eventsUrl(params));
    const forward = (event: MessageEvent): void => {
      try {
        subscriber.next(JSON.parse(event.data) as LiveEvent);
      } catch {
        // ignore a malformed frame; the stream stays open
      }
    };
    source.addEventListener('trace', forward as EventListener);
    source.addEventListener('heartbeat', forward as EventListener);
    source.onopen = () => subscriber.next({ kind: 'status', status: 'open' });
    source.onerror = () => subscriber.next({ kind: 'status', status: 'error' });
    return () => source.close();
  });
}

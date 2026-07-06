/**
 * DI tokens. Client services inject EVENT_TRACER_TRANSPORT (the Transport
 * port) and get tracing invisibly — zero tracing code, no inheritance.
 */
export const EVENT_TRACER_OPTIONS = Symbol('EVENT_TRACER_OPTIONS');
export const EVENT_TRACER_RUNTIME = Symbol('EVENT_TRACER_RUNTIME');
export const EVENT_TRACER_TRANSPORT = Symbol('EVENT_TRACER_TRANSPORT');

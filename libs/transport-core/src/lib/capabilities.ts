import { CapabilityError } from './errors';

export type CapabilityLevel = 'native' | 'emulated' | 'none';

/** What a transport supports, natively or emulated (spec §4 capability matrix). */
export interface Capabilities {
  readonly pubsub: CapabilityLevel;
  readonly reqreply: CapabilityLevel;
}

export type RequiredCapabilities = Partial<Record<keyof Capabilities, boolean>>;

/**
 * Called at wiring time (module/factory construction), never at runtime:
 * a capability mismatch must fail loudly before any message flows.
 */
export function assertCapabilities(
  required: RequiredCapabilities,
  caps: Capabilities,
  transportName: string
): void {
  const missing = (Object.keys(caps) as Array<keyof Capabilities>).filter(
    (key) => required[key] === true && caps[key] === 'none'
  );
  if (missing.length > 0) {
    throw new CapabilityError(
      `Transport '${transportName}' does not support required capabilities: ${missing.join(', ')}. ` +
        `Available: pubsub=${caps.pubsub}, reqreply=${caps.reqreply}.`
    );
  }
}

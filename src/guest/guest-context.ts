
export interface GuestContext {
  resortId: string;
  guestId: string;
}

// Identidade fictícia, exclusivamente para desenvolvimento.
export const DEMO_GUEST_CONTEXT: Readonly<GuestContext> =
  Object.freeze({
    resortId: 'demo',
    guestId: 'guest-demo-001',
  });


export interface GuestContext {
  resortId: string;
  guestId: string;
}

export const DEMO_GUEST_CONTEXT: Readonly<GuestContext> =
  Object.freeze({
    resortId: 'demo',
    guestId: 'guest-demo-001',
  });

/**
 * Notification adapter (transactional email via Resend; SMS is a disabled stub).
 *
 * Requirement coverage:
 *   FR-ADP-NOTIF-01  Provider-agnostic notification interface.
 *   FR-ADP-NOTIF-02  Resend is the Phase 1 email provider; noop default keeps
 *                    launch cost at $0 until configured.
 *   FR-ADP-NOTIF-03  No paid SMS in Phase 1 — sendSms is a guarded stub.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Template + version for audit + versioned wording. */
  templateKey: string;
  templateVersion: string;
}

export interface NotificationResult {
  delivered: boolean;
  provider: string;
  providerMessageId: string | null;
}

export interface NotificationAdapter {
  readonly name: string;
  sendEmail(msg: EmailMessage): Promise<NotificationResult>;
  sendSms(): Promise<NotificationResult>;
}

/** No-op: records intent only. Used until Resend is configured. */
export class NoopNotificationAdapter implements NotificationAdapter {
  readonly name = 'noop';
  async sendEmail(): Promise<NotificationResult> {
    return { delivered: false, provider: 'noop', providerMessageId: null };
  }
  async sendSms(): Promise<NotificationResult> {
    return { delivered: false, provider: 'noop', providerMessageId: null };
  }
}

/** Resend transactional email. Requires RESEND_API_KEY. */
export class ResendNotificationAdapter implements NotificationAdapter {
  readonly name = 'resend';
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async sendEmail(msg: EmailMessage): Promise<NotificationResult> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
      }),
    });
    if (!res.ok) {
      return { delivered: false, provider: 'resend', providerMessageId: null };
    }
    const data = (await res.json()) as { id?: string };
    return { delivered: true, provider: 'resend', providerMessageId: data.id ?? null };
  }

  async sendSms(): Promise<NotificationResult> {
    // FR-ADP-NOTIF-03: SMS intentionally disabled in Phase 1.
    return { delivered: false, provider: 'resend', providerMessageId: null };
  }
}

export function getNotificationAdapter(): NotificationAdapter {
  const provider = process.env.NOTIFICATION_PROVIDER ?? 'noop';
  if (provider === 'resend' && process.env.RESEND_API_KEY) {
    return new ResendNotificationAdapter(
      process.env.RESEND_API_KEY,
      process.env.NOTIFICATION_FROM_EMAIL ?? 'dispatch@mcglobalfreightllc.com',
    );
  }
  return new NoopNotificationAdapter();
}

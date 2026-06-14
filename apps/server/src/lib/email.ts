type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

function getEmailFrom(): string | null {
  const from = process.env['EMAIL_FROM']?.trim();
  return from || null;
}

function isResendConfigured(): boolean {
  return Boolean(process.env['RESEND_API_KEY']?.trim() && getEmailFrom());
}

async function sendViaResend(input: SendEmailInput): Promise<void> {
  const apiKey = process.env['RESEND_API_KEY']!.trim();
  const from = getEmailFrom()!;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html ?? input.text.replace(/\n/g, '<br>'),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend email failed (${res.status}): ${body || res.statusText}`);
  }
}

/** Send transactional email. Uses Resend when configured; logs in dev otherwise. */
export function sendEmail(input: SendEmailInput): void {
  if (isResendConfigured()) {
    void sendViaResend(input).catch((err) => {
      console.error('[Email] Failed to send:', err);
    });
    return;
  }

  if (process.env['NODE_ENV'] !== 'production') {
    console.info('[Email] (dev — no RESEND_API_KEY) To:', input.to);
    console.info('[Email] Subject:', input.subject);
    console.info('[Email] Body:\n', input.text);
    return;
  }

  console.warn('[Email] RESEND_API_KEY and EMAIL_FROM are required in production — message not sent to', input.to);
}

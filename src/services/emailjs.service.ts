import "server-only";

/**
 * Module 3 (Member 3): EmailJS, for the Smart Notification System.
 *
 * EmailJS is normally a browser SDK, which would mean an email only goes out if
 * the recipient happens to have the page open — useless for alerts, since the
 * entire point is reaching someone who is *not* looking at the app. Their REST
 * endpoint supports server-side sending instead, which is what this uses.
 *
 * That endpoint requires the private key as `accessToken`; without it EmailJS
 * rejects non-browser callers with "API calls are disabled for non-browser
 * applications". The private key must therefore stay server-side, which is why
 * this module is `server-only` and the key is never sent to the client.
 *
 * Being unconfigured is a normal state that degrades to SKIPPED rather than
 * failing the action that triggered the notification.
 */

const SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;

export interface EmailResult {
  ok: boolean;
  providerId?: string;
  reason?: string;
  unconfigured?: boolean;
}

export interface EmailPayload {
  toEmail: string;
  toName: string;
  subject: string;
  message: string;
}

export class EmailJsService {
  static isConfigured(): boolean {
    return Boolean(SERVICE_ID && TEMPLATE_ID && PUBLIC_KEY && PRIVATE_KEY);
  }

  static async send(payload: EmailPayload): Promise<EmailResult> {
    if (!EmailJsService.isConfigured()) {
      return { ok: false, unconfigured: true, reason: "EmailJS is not configured on this deployment." };
    }

    try {
      const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: SERVICE_ID,
          template_id: TEMPLATE_ID,
          user_id: PUBLIC_KEY,
          accessToken: PRIVATE_KEY,
          // These names are the template variables the EmailJS template must
          // declare. Documented in .env.example so the template and this code
          // cannot drift apart silently.
          template_params: {
            to_email: payload.toEmail,
            to_name: payload.toName,
            subject: payload.subject,
            message: payload.message,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        // EmailJS returns plain text on failure, not JSON.
        const text = (await res.text().catch(() => "")).trim();
        return { ok: false, reason: text || `EmailJS returned ${res.status}.` };
      }

      return { ok: true, providerId: "emailjs" };
    } catch (e) {
      const reason =
        e instanceof Error && e.name === "TimeoutError" ? "EmailJS timed out." : "Could not reach EmailJS.";
      return { ok: false, reason };
    }
  }
}

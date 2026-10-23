import net from "node:net";
import { getEnv } from "@/lib/security/env";

export interface SendReportEmailParams {
  to: string[];
  subject: string;
  html: string;
}

export interface SendReportEmailResult {
  delivered: boolean;
  recipients: string[];
  smtpHost: string;
  smtpPort: number;
  error?: string;
}

/**
 * Formats an RFC 5322 MIME HTML email payload for SMTP DATA transmission.
 */
export function buildMimeHtmlEmail(params: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  date?: Date;
}): string {
  const now = (params.date ?? new Date()).toUTCString();
  const safeSubject = params.subject.replace(/[\r\n]+/g, " ").trim();
  const bodyLines = params.html
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");

  return [
    `From: ${params.from}`,
    `To: ${params.to.join(", ")}`,
    `Subject: =?UTF-8?B?${Buffer.from(safeSubject, "utf8").toString("base64")}?=`,
    `Date: ${now}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    "",
    bodyLines,
    ".",
    "",
  ].join("\r\n");
}

/**
 * Lightweight zero-dependency SMTP client for delivering scheduled HTML reports
 * to Mailpit (`smtp://localhost:1025`) in development or a relay in production.
 */
export async function sendReportEmailViaSmtp(
  params: SendReportEmailParams,
): Promise<SendReportEmailResult> {
  const env = getEnv();
  const smtpUrlStr = env.SMTP_URL || "smtp://localhost:1025";
  const fromAddr = env.EMAIL_FROM || "RankPilot <reports@localhost>";

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(smtpUrlStr);
  } catch {
    return {
      delivered: false,
      recipients: params.to,
      smtpHost: "invalid",
      smtpPort: 0,
      error: `Invalid SMTP_URL: ${smtpUrlStr}`,
    };
  }

  const host = parsedUrl.hostname || "localhost";
  const port = Number(parsedUrl.port || 1025);

  if (params.to.length === 0) {
    return {
      delivered: false,
      recipients: [],
      smtpHost: host,
      smtpPort: port,
      error: "No recipient email addresses configured",
    };
  }

  const envelopeFromMatch = /<([^>]+)>/.exec(fromAddr);
  const envelopeFrom = envelopeFromMatch ? envelopeFromMatch[1]! : fromAddr;
  const mimePayload = buildMimeHtmlEmail({
    from: fromAddr,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });

  return new Promise<SendReportEmailResult>((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 4000 });
    let step = 0;
    let rcptIdx = 0;
    let resolved = false;

    const finish = (res: SendReportEmailResult) => {
      if (resolved) return;
      resolved = true;
      try {
        socket.end();
      } catch {
        socket.destroy();
      }
      resolve(res);
    };

    socket.on("timeout", () => {
      finish({
        delivered: false,
        recipients: params.to,
        smtpHost: host,
        smtpPort: port,
        error: "SMTP connection timeout",
      });
    });

    socket.on("error", (err) => {
      finish({
        delivered: false,
        recipients: params.to,
        smtpHost: host,
        smtpPort: port,
        error: err.message,
      });
    });

    socket.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      const code = Number(text.slice(0, 3));
      if (code >= 400) {
        finish({
          delivered: false,
          recipients: params.to,
          smtpHost: host,
          smtpPort: port,
          error: `SMTP error ${code}: ${text.trim()}`,
        });
        return;
      }

      if (step === 0 && code === 220) {
        step = 1;
        socket.write(`EHLO rankpilot.local\r\n`);
      } else if (step === 1 && code === 250) {
        step = 2;
        socket.write(`MAIL FROM:<${envelopeFrom}>\r\n`);
      } else if (step === 2 && code === 250) {
        if (rcptIdx < params.to.length) {
          const rcpt = params.to[rcptIdx]!;
          rcptIdx += 1;
          socket.write(`RCPT TO:<${rcpt}>\r\n`);
        } else {
          step = 3;
          socket.write(`DATA\r\n`);
        }
      } else if (step === 3 && code === 354) {
        step = 4;
        socket.write(mimePayload);
      } else if (step === 4 && code === 250) {
        step = 5;
        try {
          socket.write(`QUIT\r\n`);
        } catch {
          // ignore
        }
        finish({
          delivered: true,
          recipients: params.to,
          smtpHost: host,
          smtpPort: port,
        });
      }
    });
  });
}

import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMimeHtmlEmail, sendReportEmailViaSmtp } from "@/lib/reports/mailer";
import { isReportScheduleDue } from "@/lib/reports/service";
import { resetEnvCacheForTests } from "@/lib/security/env";

/** Minimal in-process SMTP server that records the DATA payload. */
function startFakeSmtpServer(): Promise<{
  port: number;
  received: { rcpts: string[]; data: string };
  close: () => Promise<void>;
}> {
  const received = { rcpts: [] as string[], data: "" };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => {
      sockets.delete(socket);
    });
    let inData = false;
    socket.write("220 fake-smtp ready\r\n");
    socket.on("data", (buf) => {
      const text = buf.toString("utf8");
      if (inData) {
        received.data += text;
        if (received.data.endsWith("\r\n.\r\n")) {
          inData = false;
          socket.write("250 queued\r\n");
        }
        return;
      }
      if (text.startsWith("EHLO")) socket.write("250 fake-smtp\r\n");
      else if (text.startsWith("MAIL FROM")) socket.write("250 ok\r\n");
      else if (text.startsWith("RCPT TO")) {
        received.rcpts.push(/<([^>]+)>/.exec(text)?.[1] ?? "");
        socket.write("250 ok\r\n");
      } else if (text.startsWith("DATA")) {
        inData = true;
        socket.write("354 go ahead\r\n");
      } else if (text.startsWith("QUIT")) {
        socket.end("221 bye\r\n");
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        received,
        close: () =>
          new Promise<void>((r) => {
            for (const s of sockets) {
              try {
                s.destroy();
              } catch {
                // ignore
              }
            }
            server.close(() => r());
          }),
      });
    });
  });
}

describe("Phase 6: scheduled report delivery", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCacheForTests();
  });

  it("decides schedule due-ness from cadence windows", () => {
    const now = new Date("2026-10-23T09:00:00.000Z");
    expect(isReportScheduleDue({ cadence: "weekly", lastReportAt: null, now })).toBe(true);
    expect(
      isReportScheduleDue({ cadence: "weekly", lastReportAt: new Date("2026-10-20T09:00:00.000Z"), now }),
    ).toBe(false);
    expect(
      isReportScheduleDue({ cadence: "weekly", lastReportAt: new Date("2026-10-16T09:00:00.000Z"), now }),
    ).toBe(true);
    expect(
      isReportScheduleDue({ cadence: "monthly", lastReportAt: new Date("2026-10-01T09:00:00.000Z"), now }),
    ).toBe(false);
  });

  it("builds a UTF-8 MIME email with an encoded Bengali subject and dot-stuffed body", () => {
    const mime = buildMimeHtmlEmail({
      from: "RankPilot <reports@localhost>",
      to: ["a@example.com", "b@example.com"],
      subject: "সাপ্তাহিক SEO রিপোর্ট\r\nBcc: attacker@example.com",
      html: "<p>Hello</p>\n.hidden-line",
      date: new Date("2026-10-23T09:00:00.000Z"),
    });

    expect(mime).toContain("To: a@example.com, b@example.com");
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    // Header injection via CRLF in subject is neutralized (encoded into the subject, not a header)
    expect(mime).not.toMatch(/\r\nBcc:/);
    expect(mime).toContain("\r\n..hidden-line");
    expect(mime.endsWith("\r\n.\r\n")).toBe(true);
  });

  it("delivers a report over SMTP to every recipient", async () => {
    const smtp = await startFakeSmtpServer();
    vi.stubEnv("SMTP_URL", `smtp://127.0.0.1:${smtp.port}`);
    resetEnvCacheForTests();
    try {
      const res = await sendReportEmailViaSmtp({
        to: ["owner@example.com", "team@example.com"],
        subject: "Weekly SEO report",
        html: "<h1>Report</h1>",
      });
      expect(res.delivered).toBe(true);
      expect(smtp.received.rcpts).toEqual(["owner@example.com", "team@example.com"]);
      expect(smtp.received.data).toContain("<h1>Report</h1>");
    } finally {
      await smtp.close();
    }
  });

  it("reports a clean failure when no recipients are configured", async () => {
    const res = await sendReportEmailViaSmtp({ to: [], subject: "x", html: "<p/>" });
    expect(res.delivered).toBe(false);
    expect(res.error).toMatch(/No recipient/);
  });
});

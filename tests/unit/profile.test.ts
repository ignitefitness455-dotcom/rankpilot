import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE_FIELDS, serializeProjectProfile } from "@/lib/projects/profile";
import { hasMinimumRole } from "@/lib/security/authz";

describe("lib/projects/profile — deterministic prefix serialization", () => {
  it("produces byte-identical XML regardless of input array order", () => {
    const a = serializeProjectProfile({
      projectId: "11111111-1111-4111-8111-111111111111",
      name: "Acme",
      url: "https://acme.com",
      host: "acme.com",
      cms: "Next.js",
      language: "en",
      version: 3,
      fields: {
        ...DEFAULT_PROFILE_FIELDS,
        countries: ["bd", "us", "gb"],
        languages: ["bn", "en"],
        competitorHosts: ["vercel.com", "fly.io"],
      },
    });

    const b = serializeProjectProfile({
      projectId: "11111111-1111-4111-8111-111111111111",
      name: "Acme",
      url: "https://acme.com",
      host: "acme.com",
      cms: "Next.js",
      language: "en",
      version: 3,
      fields: {
        ...DEFAULT_PROFILE_FIELDS,
        countries: ["GB", "BD", "US"],
        languages: ["en", "bn"],
        competitorHosts: ["fly.io", "vercel.com"],
      },
    });

    expect(a).toBe(b);
    expect(a).toContain('<project_profile v="3">');
    expect(a).toContain("target_countries: BD, GB, US");
    expect(a).toContain("competitor_hosts: fly.io, vercel.com");
  });

  it("enforces role hierarchy weights", () => {
    expect(hasMinimumRole("owner", "editor")).toBe(true);
    expect(hasMinimumRole("editor", "viewer")).toBe(true);
    expect(hasMinimumRole("viewer", "editor")).toBe(false);
  });
});

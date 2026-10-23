import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { getEnv } from "@/lib/security/env";
import { getOrCreateUserSettings } from "@/lib/settings/service";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function buildAuthConfig(): NextAuthConfig {
  const env = getEnv();
  const adminDb = getAdminDb();

  const providers: NextAuthConfig["providers"] = [];

  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
      }),
    );
  }

  const authorizeCredentials = async (rawCredentials: any) => {
    const email =
      (typeof rawCredentials?.email === "string" && rawCredentials.email.trim().toLowerCase()) ||
      "founder@rankpilot.local";
    const name =
      (typeof rawCredentials?.name === "string" && rawCredentials.name.trim()) ||
      "Solo Site Owner";

    const [existing] = await adminDb
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let userRecord = existing;
    if (!userRecord) {
      const [created] = await adminDb
        .insert(users)
        .values({
          email,
          name,
          emailVerified: new Date(),
        })
        .returning();
      userRecord = created!;
    }

    await getOrCreateUserSettings(userRecord.id);
    return {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      image: userRecord.image,
    };
  };

  providers.push(
    Credentials({
      id: "credentials",
      name: "Site Owner",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "founder@rankpilot.local" },
        name: { label: "Name", type: "text", placeholder: "Solo Site Owner" },
      },
      authorize: authorizeCredentials,
    }),
  );

  providers.push(
    Credentials({
      id: "dev-login",
      name: "Local Dev Account",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "founder@rankpilot.local" },
        name: { label: "Name", type: "text", placeholder: "Solo Site Owner" },
      },
      authorize: authorizeCredentials,
    }),
  );

  return {
    adapter: DrizzleAdapter(adminDb, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    secret: env.AUTH_SECRET,
    session: { strategy: "jwt" },
    pages: {
      signIn: "/en/sign-in",
    },
    providers,
    callbacks: {
      async jwt({ token, user }) {
        if (user?.id) {
          token.sub = user.id;
        }
        return token;
      },
      async session({ session, token }) {
        if (session.user && token.sub) {
          session.user.id = token.sub;
        }
        return session;
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(buildAuthConfig);

export async function requireAuthUser(): Promise<{
  id: string;
  email: string | null;
  name: string | null;
}> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
  };
}

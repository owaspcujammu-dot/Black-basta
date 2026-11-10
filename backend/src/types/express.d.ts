import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface AuthUser {
      id: number;
      username: string;
      fullName: string;
      email: string;
      teamName: string | null;
      members: string[];
      role: Role;
      participantNumber: number | null;
      score: number;
      solvedCount: number;
      disabled: boolean;
      tokenVersion: number;
      lastActivity: Date | null;
    }

    interface Request {
      /** Verified session claims (signature only, no database lookup). */
      auth?: { id: number; role: Role; tv: number; sid: string };
      /** Fresh user record, loaded by requireAuth. */
      user?: AuthUser;
      /** Team member playing on this device (team logins), from the session. */
      player?: string | null;
    }
  }
}

export {};

export type Role = 'participant' | 'admin';
export type EventState = 'UPCOMING' | 'LIVE' | 'PAUSED' | 'ENDED';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'INSANE';
/** STATIC: fixed points. DYNAMIC: drops from the starting value towards a minimum as more crews solve it. */
export type Scoring = 'STATIC' | 'DYNAMIC';

export interface User {
  id: number;
  username: string;
  fullName: string;
  email: string;
  teamName: string | null;
  members: string[];
  /** Team member playing on this device (team logins). */
  player?: string | null;
  role: Role;
  participantNumber: number | null;
  score: number;
  solved: number;
  rank: number | null;
}

/** One team member's share of the team score. */
export interface PlayerScore {
  name: string;
  score: number;
  solved: number;
}

export interface EventInfo {
  name: string;
  state: EventState;
  startsAt: string | null;
  endsAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  serverTime: string;
  participants: number;
  maxParticipants: number;
  flagFormat: string;
  firstBloodBonus: number;
  demoMode: boolean;
  /** False when only organizers create team accounts. */
  registrationOpen: boolean;
  maxTeamSize: number;
  /** Change counters, used when live streaming is unavailable. */
  versions?: { challenges: number; announcements: number };
  /** Scoreboard freeze time (null: none), and whether it is frozen now. */
  freezeAt?: string | null;
  frozen?: boolean;
}

export interface ScoreboardEntry {
  rank: number;
  userId: number;
  username: string;
  teamName: string | null;
  /** Points per team member (empty for solo accounts). */
  players: PlayerScore[];
  score: number;
  solved: number;
  lastCapture: string | null;
  title: string;
}

export interface Scoreboard {
  entries: ScoreboardEntry[];
  generatedAt: string;
  /** Set while frozen: the standings as they were at this time. */
  frozenAt?: string | null;
}

/** Score over time for one of the leading teams (the scoreboard graph). */
export interface ScoreHistorySeries {
  userId: number;
  username: string;
  rank: number;
  points: { at: string; score: number }[];
}

export interface ScoreHistory {
  /** When the event started (the graph's left edge), or null if it has not. */
  from: string | null;
  /** The event's end, now while it runs, or the freeze time while frozen. */
  to: string;
  frozenAt?: string | null;
  series: ScoreHistorySeries[];
}

/** One crew that claimed a challenge. */
export interface ChallengeSolve {
  username: string;
  player: string | null;
  solvedAt: string;
  firstBlood: boolean;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
}

export interface ChallengeCard {
  id: number;
  title: string;
  slug: string;
  category: Category;
  difficulty: Difficulty;
  /** Current value (dynamic challenges drop as more crews solve them). */
  points: number;
  scoring: Scoring;
  initialPoints: number;
  minimumPoints: number | null;
  /** Practice challenge: open any time, never scored. */
  practice: boolean;
  enabled: boolean;
  solves: number;
  firstBlood: string | null;
  solved: boolean;
  /** Team member who claimed it. */
  solvedBy?: string | null;
}

export interface Hint {
  id: number;
  number: number;
  cost: number;
  unlocked: boolean;
  content: string | null;
}

export interface ChallengeDetail extends Omit<ChallengeCard, 'firstBlood'> {
  description: string;
  solvedAt: string | null;
  solvedBy?: string | null;
  /** Dynamic: solves after which the value reaches the minimum. */
  decay: number | null;
  pointsAwarded: number | null;
  firstBlood: { username: string; at: string; bonus: number } | null;
  hints: Hint[];
  attachments: { id: number; name: string; size: number }[];
}

export interface Achievement {
  code: string;
  name: string;
  description: string;
  icon: string;
  earned?: boolean;
  awardedAt?: string | null;
}

export interface SubmitResult {
  correct: boolean;
  message: string;
  formatHint?: string;
  test?: boolean;
  /** A practice challenge: recorded for the crew, no points. */
  practice?: boolean;
  alreadySolved?: boolean;
  pointsAwarded?: number;
  basePoints?: number;
  firstBlood?: boolean;
  firstBloodBonus?: number;
  newScore?: number;
  achievements?: Achievement[];
}

export interface Announcement {
  id: number;
  title: string;
  message: string;
  createdAt: string;
}

export interface Profile {
  username: string;
  fullName: string;
  email: string;
  teamName: string | null;
  members: string[];
  players: PlayerScore[];
  player: string | null;
  role: Role;
  participantNumber: number | null;
  rank: number | null;
  score: number;
  solved: number;
  totalChallenges: number;
  submissions: number;
  accuracy: number | null;
  firstBloods: number;
  hintSpend: number;
  solves: { challengeId: number; title: string; category: string; difficulty: Difficulty; points: number; firstBlood: boolean; solvedBy: string | null; solvedAt: string }[];
  achievements: Required<Achievement>[];
}

// --- admin -----------------------------------------------------------------

export interface AdminStats {
  registered: number;
  maxParticipants: number;
  active: number;
  online: number;
  connections: number;
  disabled: number;
  challenges: number;
  enabledChallenges: number;
  submissions: number;
  correctSubmissions: number;
}

export interface AdminDashboard {
  stats: AdminStats;
  event: EventInfo;
  recentSubmissions: { id: number; username: string; player: string | null; challenge: string; correct: boolean; submittedAt: string }[];
}

export interface AdminChallenge {
  id: number;
  title: string;
  slug: string;
  description: string;
  category: { id: number; name: string };
  difficulty: Difficulty;
  points: number;
  scoring: Scoring;
  minimumPoints: number | null;
  decay: number | null;
  /** What solvers hold now. */
  currentValue: number;
  practice: boolean;
  flagCaseInsensitive: boolean;
  /** Number of further accepted flags (read them with GET /admin/challenges/:id/flags). */
  extraFlagCount: number;
  /** Whether the admin panel can show the flag (false = saved before flags were viewable; re-enter it once). */
  flagViewable: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  hints: { id: number; content: string; cost: number }[];
  attachments: { id: number; name: string; size: number }[];
  solves: number;
  submissions: number;
  firstBlood: string | null;
}

export interface AdminUser {
  id: number;
  username: string;
  fullName: string;
  email: string;
  teamName: string | null;
  members: string[];
  players: PlayerScore[];
  /** Devices currently logged in. */
  devices: number;
  /** Whether the admin panel can show the password (organizer-set passwords only). */
  passwordViewable: boolean;
  role: Role;
  participantNumber: number | null;
  score: number;
  solved: number;
  disabled: boolean;
  createdAt: string;
  lastActivity: string | null;
}

export interface AdminSubmission {
  id: number;
  challenge: string;
  player: string | null;
  submittedFlag: string;
  correct: boolean;
  submittedAt: string;
}

/** GET /admin/challenges/:id/flags — null where a flag was saved before flags were viewable. */
export interface AdminChallengeFlags {
  id: number;
  title: string;
  flagCaseInsensitive: boolean;
  flag: string | null;
  extraFlags: (string | null)[];
}

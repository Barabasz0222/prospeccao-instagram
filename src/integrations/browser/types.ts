export type SendDmInput = {
  jobId: number;
  leadId: number;
  profileUrl: string;
  igUsername: string;
  message: string;
  variantId?: string;
  /** Per-character typing delay in ms. */
  typingDelayMs?: number;
};

export type SendDmEvidence = {
  url?: string;
  screenshotPath?: string;
  accessibilitySnapshotPath?: string;
  consoleErrors?: string[];
  networkFailures?: string[];
};

export type SendDmResult =
  | { status: "sent"; evidence: SendDmEvidence }
  | { status: "blocked"; reason: string; evidence: SendDmEvidence }
  | { status: "failed"; error: string; evidence: SendDmEvidence };

export type DiscoveredProfile = {
  igUsername: string;
  profileUrl: string;
  displayName?: string;
  bio?: string;
  category?: string;
  location?: string;
  followerCount?: number;
};

export type DiscoverQuery = {
  /**
   * "hashtag" opens the tag page and reads the authors of recent posts.
   * "keyword" runs the search box and reads the account results.
   * "related" opens a seed profile and reads its "similar accounts".
   */
  kind: "keyword" | "hashtag" | "related";
  term: string;
  limit: number;
};

/** Full public signals for one profile, read from the rendered profile page. */
export type ProfileSignals = {
  igUsername: string;
  profileUrl: string;
  displayName: string | null;
  bio: string | null;
  category: string | null;
  location: string | null;
  followerCount: number | null;
  followingCount: number | null;
  postCount: number | null;
  externalUrl: string | null;
  isPrivate: boolean;
  isVerified: boolean;
  /** Hashtags seen in the bio. */
  bioHashtags: string[];
};

/** A pluggable browser driver so tests can swap in a fake CDP client. */
export interface BrowserDriver {
  /** Verifies the CDP endpoint is reachable and a logged-in IG session exists. */
  healthCheck(): Promise<{ ok: boolean; reason?: string }>;
  sendDm(input: SendDmInput): Promise<SendDmResult>;
  /** Returns candidate handles (light — username + url only). */
  discoverProfiles(query: DiscoverQuery): Promise<DiscoveredProfile[]>;
  /** Visits one profile and reads its public signals. null if unreachable. */
  enrichProfile(igUsername: string): Promise<ProfileSignals | null>;
}

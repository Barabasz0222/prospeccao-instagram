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
  /** "keyword" searches the people tab; "hashtag" opens the tag's top posts. */
  kind: "keyword" | "hashtag";
  term: string;
  limit: number;
};

/** A pluggable browser driver so tests can swap in a fake CDP client. */
export interface BrowserDriver {
  /** Verifies the CDP endpoint is reachable and a logged-in IG session exists. */
  healthCheck(): Promise<{ ok: boolean; reason?: string }>;
  sendDm(input: SendDmInput): Promise<SendDmResult>;
  discoverProfiles(query: DiscoverQuery): Promise<DiscoveredProfile[]>;
}

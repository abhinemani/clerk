/**
 * The weekly network rebuild (docs/network-plays.md, invariant 11).
 *
 * The pure functions are tested in src/domain/networkPlays.test.ts. What is
 * tested HERE is everything the pure functions cannot enforce because it is
 * the caller's behavior: consent gating end to end, that nothing
 * agency-identifying reaches the store, full-replace semantics, the
 * stability hold, and contribute-to-read on the way back out.
 */
import { describe, expect, it } from "vitest";
import { MIN_AGENCIES } from "@/domain/networkPlays";
import type { ServiceDeps } from "./deps";
import { InMemoryRepository, type Agency, type PlayEntity } from "./repository";
import { listNetworkAggregatesFor, rebuildNetworkAggregates } from "./networkPlaysService";

const NOW = new Date("2026-08-15T12:00:00Z");

function makeDeps(): { deps: ServiceDeps; repo: InMemoryRepository } {
  let n = 0;
  const repo = new InMemoryRepository();
  return {
    repo,
    deps: { repo, now: () => NOW, genId: () => `id-${++n}`, genToken: () => `tok-${n}` },
  };
}

const agencyOf = (id: string, consented: boolean, stateCode = "CA"): Agency =>
  ({
    id,
    slug: id,
    name: `Agency ${id}`,
    stateCode,
    observedHolidays: [],
    settings: consented ? { networkPlays: { enabled: true } } : {},
  }) as Agency;

/** A play that maps cleanly onto building_permits → public_works. */
const playOf = (agencyId: string, episodeCount = 6): PlayEntity => ({
  id: `play-${agencyId}`,
  agencyId,
  topic: "building permit construction",
  keywords: ["building", "permit", "construction"],
  stats: {
    routes: [{ departmentId: `d-${agencyId}`, department: "Public Works", share: 0.8 }],
    exemptions: [{ label: "Personal privacy", count: 2 }],
    outcomes: { fulfilled: 6 },
    medianDaysToClose: 6,
    extensionRate: 0.15,
    samplePublicIds: [`PR-2026-000${agencyId}`],
  },
  episodeCount,
  embedding: null,
  rebuiltAt: NOW,
  createdAt: NOW,
});

/** N consenting agencies, each with one mapping play. */
async function seedNetwork(repo: InMemoryRepository, count: number, consented = true) {
  for (let i = 0; i < count; i++) {
    const id = `ag${i}`;
    repo.seedAgency(agencyOf(id, consented));
    await repo.replaceAgencyPlays(id, [playOf(id)]);
  }
}

describe("rebuildNetworkAggregates", () => {
  it("publishes once enough consenting agencies clear the floors", async () => {
    const { deps, repo } = makeDeps();
    await seedNetwork(repo, MIN_AGENCIES);

    const summary = await rebuildNetworkAggregates(deps);
    expect(summary.consentingAgencies).toBe(MIN_AGENCIES);
    expect(summary.contributions).toBe(MIN_AGENCIES);
    expect(summary.published).toBe(1);

    const stored = await repo.listNetworkAggregates();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.topic).toBe("building_permits");
    expect(stored[0]!.agencyCount).toBe(MIN_AGENCIES);
    expect(stored[0]!.routes[0]!.role).toBe("public_works");
  });

  it("stores NOTHING that identifies a contributor (invariant 11)", async () => {
    const { deps, repo } = makeDeps();
    await seedNetwork(repo, MIN_AGENCIES);
    await rebuildNetworkAggregates(deps);

    const serialized = JSON.stringify(await repo.listNetworkAggregates());
    for (let i = 0; i < MIN_AGENCIES; i++) {
      expect(serialized).not.toContain(`ag${i}`); // agency id
      expect(serialized).not.toContain(`d-ag${i}`); // department id
      expect(serialized).not.toContain(`PR-2026-000ag${i}`); // sample publicId
    }
    // The tenant-authored play topic/keywords must not survive either.
    expect(serialized).not.toContain("building permit construction");
    expect(serialized).not.toContain("Public Works"); // the tenant's dept NAME
    expect(serialized).not.toContain("agencyId");
  });

  it("publishes nothing when nobody has consented — and writes no rows", async () => {
    const { deps, repo } = makeDeps();
    await seedNetwork(repo, MIN_AGENCIES, false);

    const summary = await rebuildNetworkAggregates(deps);
    expect(summary.consentingAgencies).toBe(0);
    expect(summary.contributions).toBe(0);
    expect(summary.published).toBe(0);
    expect(await repo.listNetworkAggregates()).toEqual([]);
  });

  it("withholds while below the agency floor, then publishes when it is reached", async () => {
    const { deps, repo } = makeDeps();
    await seedNetwork(repo, MIN_AGENCIES - 1);
    expect((await rebuildNetworkAggregates(deps)).published).toBe(0);
    expect(await repo.listNetworkAggregates()).toEqual([]);

    // One more agency opts in → the floor is met.
    repo.seedAgency(agencyOf("late", true));
    await repo.replaceAgencyPlays("late", [playOf("late")]);
    expect((await rebuildNetworkAggregates(deps)).published).toBe(1);
  });

  it("a revoking agency is excluded from the next rebuild", async () => {
    const { deps, repo } = makeDeps();
    await seedNetwork(repo, MIN_AGENCIES);
    await rebuildNetworkAggregates(deps);
    expect(await repo.listNetworkAggregates()).toHaveLength(1);

    // Consent withdrawn → drops below the floor → the benchmark disappears.
    await repo.updateAgency("ag0", { settings: { networkPlays: { enabled: false } } });
    const summary = await rebuildNetworkAggregates(deps);
    expect(summary.consentingAgencies).toBe(MIN_AGENCIES - 1);
    expect(summary.published).toBe(0);
    expect(await repo.listNetworkAggregates()).toEqual([]);
  });

  it("FULL REPLACE — never an appended series (differencing lives on series)", async () => {
    const { deps, repo } = makeDeps();
    await seedNetwork(repo, MIN_AGENCIES);
    await rebuildNetworkAggregates(deps);
    await rebuildNetworkAggregates(deps);
    await rebuildNetworkAggregates(deps);
    expect(await repo.listNetworkAggregates()).toHaveLength(1);
  });

  it("HOLDS a group for one cycle when its agency count moves (stability rule)", async () => {
    const { deps, repo } = makeDeps();
    await seedNetwork(repo, MIN_AGENCIES);
    await rebuildNetworkAggregates(deps);
    expect((await repo.listNetworkAggregates())[0]!.agencyCount).toBe(MIN_AGENCIES);

    // A sixth agency joins: the count moved, so the published numbers must
    // NOT move this cycle — otherwise an observer gets an instantly
    // diffable before/after pair naming exactly one new contributor.
    repo.seedAgency(agencyOf("ag-new", true));
    await repo.replaceAgencyPlays("ag-new", [playOf("ag-new")]);

    const summary = await rebuildNetworkAggregates(deps);
    expect(summary.heldForStability).toBe(1);
    expect((await repo.listNetworkAggregates())[0]!.agencyCount).toBe(MIN_AGENCIES);

    // Once membership has settled, the next cycle publishes the new numbers.
    const settled = await rebuildNetworkAggregates(deps);
    expect(settled.heldForStability).toBe(0);
    expect((await repo.listNetworkAggregates())[0]!.agencyCount).toBe(MIN_AGENCIES + 1);
  });

  it("keeps states in separate benchmarks — different statutes, different clocks", async () => {
    const { deps, repo } = makeDeps();
    await seedNetwork(repo, MIN_AGENCIES);
    for (let i = 0; i < MIN_AGENCIES; i++) {
      const id = `tx${i}`;
      repo.seedAgency(agencyOf(id, true, "TX"));
      await repo.replaceAgencyPlays(id, [playOf(id)]);
    }
    await rebuildNetworkAggregates(deps);
    const stored = await repo.listNetworkAggregates();
    expect(stored.map((r) => r.stateCode).sort()).toEqual(["CA", "TX"]);
  });
});

describe("listNetworkAggregatesFor — contribute-to-read", () => {
  it("returns the network to a consenting agency, and nothing to a non-contributor", async () => {
    const { deps, repo } = makeDeps();
    await seedNetwork(repo, MIN_AGENCIES);
    await rebuildNetworkAggregates(deps);

    expect(await listNetworkAggregatesFor(deps, "ag0")).toHaveLength(1);

    // A free-rider sees nothing — not an error, just nothing.
    repo.seedAgency(agencyOf("freerider", false));
    expect(await listNetworkAggregatesFor(deps, "freerider")).toEqual([]);
  });

  it("shows an agency only its own state's benchmarks", async () => {
    const { deps, repo } = makeDeps();
    await seedNetwork(repo, MIN_AGENCIES);
    for (let i = 0; i < MIN_AGENCIES; i++) {
      const id = `tx${i}`;
      repo.seedAgency(agencyOf(id, true, "TX"));
      await repo.replaceAgencyPlays(id, [playOf(id)]);
    }
    await rebuildNetworkAggregates(deps);

    const forCa = await listNetworkAggregatesFor(deps, "ag0");
    expect(forCa.map((a) => a.stateCode)).toEqual(["CA"]);
    const forTx = await listNetworkAggregatesFor(deps, "tx0");
    expect(forTx.map((a) => a.stateCode)).toEqual(["TX"]);
  });
});

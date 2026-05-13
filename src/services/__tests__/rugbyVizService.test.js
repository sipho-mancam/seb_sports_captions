import { describe, expect, it, vi } from "vitest";
import { RugbyVizFixturesWorker, RugbyVizQueryWorker } from "../rugbyVizService";

describe("RugbyVizQueryWorker", () => {
  it("normalizes data types against the query endpoint", async () => {
    const worker = new RugbyVizQueryWorker({
      getJson: vi.fn().mockResolvedValue({
        source: "api",
        queryEndpoint: "/api/v1/sportscaption/rugbyviz/",
        items: [{ dataType: "matchSummary", queryUri: "matches/{matchId}" }],
      }),
    });

    await expect(worker.getDataTypes()).resolves.toEqual({
      source: "api",
      queryEndpoint: "/api/v1/sportscaption/rugbyviz/",
      items: [{ dataType: "matchSummary", queryUri: "/api/v1/sportscaption/rugbyviz/matches/{matchId}" }],
    });
  });

  it("builds the selected-data query from placeholders and selected aliases", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    const worker = new RugbyVizQueryWorker({ request });

    await expect(
      worker.getSelectedData(
        {
          queryUri: "matches/{matchId}/stats",
          queryEndpoint: "/api/v1/sportscaption/rugbyviz/",
          requiredParameters: ["compId"],
          type: "match",
          dataType: "summary",
        },
        {
          selectedMatchId: "match-9",
          selectedCompetitionId: "comp-4",
        }
      )
    ).resolves.toEqual({ ok: true });

    expect(request).toHaveBeenCalledWith(
      "/api/v1/sportscaption/rugbyviz/matches/match-9/stats?compId=comp-4&type=match&dataType=summary"
    );
  });

  it("rejects requests with unresolved required parameters", async () => {
    const worker = new RugbyVizQueryWorker({ request: vi.fn() });

    await expect(
      worker.getSelectedData(
        {
          queryUri: "matches/{matchId}/stats",
          requiredParameters: ["compId"],
        },
        {}
      )
    ).rejects.toThrow("Missing required parameters for the selected data type: compId, matchId");
  });
});

describe("RugbyVizFixturesWorker", () => {
  it("filters past fixtures and groups upcoming fixtures by the viewer timezone day", () => {
    const worker = new RugbyVizFixturesWorker();
    const groupedFixtures = worker.getFixturesByDay(
      [
        {
          id: 1,
          dateTime: "2026-05-12T17:00:00.000Z",
          competition: { name: "URC" },
          season: { name: "2025/26" },
          homeTeam: { name: "Past Home", score: { finalScore: 10 } },
          awayTeam: { name: "Past Away", score: { finalScore: 8 } },
          venue: { name: "Past Venue", timezone: "Europe/London" },
        },
        {
          id: 2,
          dateTime: "2026-05-13T23:30:00.000Z",
          competition: { name: "URC" },
          season: { name: "2025/26" },
          homeTeam: { shortName: "Stormers", score: { finalScore: null } },
          awayTeam: { shortName: "Cardiff", score: { finalScore: null } },
          venue: { name: "DHL Stadium", timezone: "Africa/Johannesburg" },
          matchStatus: "fixture",
        },
        {
          id: 3,
          dateTime: "2026-05-14T18:30:00.000Z",
          competition: { name: "URC" },
          season: { name: "2025/26" },
          homeTeam: { name: "Bulls", score: { finalScore: null } },
          awayTeam: { name: "Ulster", score: { finalScore: null } },
          venue: { name: "Loftus Versfeld", timezone: "Africa/Johannesburg" },
          matchStatus: "fixture",
        },
      ],
      {
        referenceDate: new Date("2026-05-13T09:00:00.000Z"),
        timeZone: "Africa/Johannesburg",
        view: "fixtures",
      }
    );

    expect(groupedFixtures).toMatchObject({
      userTimeZone: "Africa/Johannesburg",
    });
    expect(groupedFixtures.fixtureDays).toHaveLength(1);
    expect(groupedFixtures.fixtureDays[0]).toMatchObject({
      dayKey: "2026-05-14",
      fixtures: [
        {
          id: "2",
          label: "Stormers vs Cardiff",
          timeLabel: "01:30",
          venueName: "DHL Stadium",
        },
        {
          id: "3",
          label: "Bulls vs Ulster",
        },
      ],
    });
  });

  it("filters completed results and groups them by the viewer timezone day", () => {
    const worker = new RugbyVizFixturesWorker();
    const groupedFixtures = worker.getFixturesByDay(
      [
        {
          id: 0,
          dateTime: "2026-05-07T17:00:00.000Z",
          competition: { name: "URC" },
          season: { name: "2025/26" },
          homeTeam: { name: "Old Home", score: { finalScore: 21 } },
          awayTeam: { name: "Old Away", score: { finalScore: 19 } },
          venue: { name: "Old Venue", timezone: "Europe/London" },
        },
        {
          id: 1,
          dateTime: "2026-05-12T17:00:00.000Z",
          competition: { name: "URC" },
          season: { name: "2025/26" },
          homeTeam: { name: "Past Home", score: { finalScore: 10 } },
          awayTeam: { name: "Past Away", score: { finalScore: 8 } },
          venue: { name: "Past Venue", timezone: "Europe/London" },
        },
        {
          id: 2,
          dateTime: "2026-05-13T23:30:00.000Z",
          competition: { name: "URC" },
          season: { name: "2025/26" },
          homeTeam: { shortName: "Stormers", score: { finalScore: null } },
          awayTeam: { shortName: "Cardiff", score: { finalScore: null } },
          venue: { name: "DHL Stadium", timezone: "Africa/Johannesburg" },
          matchStatus: "fixture",
        },
      ],
      {
        referenceDate: new Date("2026-05-13T09:00:00.000Z"),
        timeZone: "Africa/Johannesburg",
        view: "results",
      }
    );

    expect(groupedFixtures).toMatchObject({
      userTimeZone: "Africa/Johannesburg",
      view: "results",
    });
    expect(groupedFixtures.fixtureDays).toHaveLength(1);
    expect(groupedFixtures.fixtureDays.some((dayGroup) => dayGroup.dayKey === "2026-05-07")).toBe(false);
    expect(groupedFixtures.fixtureDays[0]).toMatchObject({
      dayKey: "2026-05-12",
      fixtures: [
        {
          id: "1",
          label: "Past Home vs Past Away",
          scoreLabel: "10 - 8",
        },
      ],
    });
  });
});
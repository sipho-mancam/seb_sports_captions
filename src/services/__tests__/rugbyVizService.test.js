import { describe, expect, it, vi } from "vitest";
import { RugbyVizQueryWorker } from "../rugbyVizService";

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
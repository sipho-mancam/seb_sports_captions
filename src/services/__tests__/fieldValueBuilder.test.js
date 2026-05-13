import { describe, expect, it } from "vitest";
import { FieldValueBuilderWorker } from "../fieldValueBuilder";

describe("FieldValueBuilderWorker", () => {
  it("normalizes scalar, combined, and single-item field mappings", () => {
    const worker = new FieldValueBuilderWorker();
    const mapping = {
      phaseLabel: 10,
      scoreboard: {
        field: 11,
        scores: ["home.score", "away.score"],
        delimiter: " - ",
      },
      officials: {
        fields: [12, 13],
        item: ["referee", "assistant"],
      },
    };
    const selectedData = {
      phaseLabel: "Post Match",
      home: { score: 24 },
      away: { score: 17 },
      officials: {
        data: {
          referee: "Fran&ccedil;ois",
          assistant: "Jos&eacute;",
        },
      },
    };

    expect(worker.build(mapping, selectedData)).toEqual({
      10: "Full-Time",
      11: "24 - 17",
      12: "Francois",
      13: "Jose",
    });
  });

  it("maps list sections from manifest rows and image-style keys", () => {
    const worker = new FieldValueBuilderWorker();
    const mapping = {
      lineup: {
        list: [
          [21, 22],
          [23, 24],
        ],
        list_item: ["name", "#img:player:headshot"],
      },
    };
    const selectedData = {
      lineup: {
        data: [
          { name: "Andre", player_headshot: "home-1.png" },
          { name: "Beyers", "player:headshot": "away-2.png" },
        ],
      },
    };

    expect(worker.build(mapping, selectedData)).toEqual({
      21: "Andre",
      22: "home-1.png",
      23: "Beyers",
      24: "away-2.png",
    });
  });
});
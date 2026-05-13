import { apiClient } from "./apiClient";

const tournamentData = {
  Rugby: {
    API: ["URC", "Rugby Championship", "Six Nations", "Currie Cup", "Investec Champions Cup"],
    "Database (MySQL)": ["URC Archive", "Premiership Rugby", "Top 14", "Super Rugby"],
    "Excel Spreadsheet": ["School Rugby", "Club Invitational", "Regional Cup"],
  },
  Cricket: {
    API: ["IPL", "World Test Championship", "The Hundred", "Champions Trophy"],
    "Database (MySQL)": ["CSA T20", "Big Bash League", "County Championship"],
    "Excel Spreadsheet": ["Local Premier League", "Academy Tournament", "Friendly Series"],
  },
};

function normalizeApiCompetition(item) {
  return {
    competitionId: item.id,
    name: item.name,
    seasonName: item.seasonName,
    seasons: (item.seasons || []).map((season) => ({
      seasonId: season.id,
      name: season.name,
    })),
  };
}

function normalizeFallbackCompetition(name, index) {
  return {
    competitionId: index + 1,
    name,
    seasonName: "Current Season",
    seasons: [
      {
        seasonId: Number(`${new Date().getFullYear()}01`),
        name: "Current",
      },
    ],
  };
}

export class TournamentCatalogWorker {
  constructor(client = apiClient) {
    this.client = client;
  }

  async getAvailableTournaments(sport, source) {
    if (!sport || !source) {
      return [];
    }

    if (sport === "Rugby" && source === "API") {
      const data = await this.client.getJson(
        "/api/v1/sportscaption/tournaments",
        "Failed to load competitions from API"
      );

      return Array.isArray(data) ? data.map(normalizeApiCompetition) : [];
    }

    const fallback = tournamentData[sport]?.[source] || [];
    return fallback.map(normalizeFallbackCompetition);
  }
}

export const tournamentCatalogWorker = new TournamentCatalogWorker();

export function getAvailableTournaments(sport, source) {
  return tournamentCatalogWorker.getAvailableTournaments(sport, source);
}
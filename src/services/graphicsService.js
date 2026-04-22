const tournamentData = {
  Rugby: {
    API: [
      "URC",
      "Rugby Championship",
      "Six Nations",
      "Currie Cup",
      "Investec Champions Cup",
    ],
    "Database (MySQL)": ["URC Archive", "Premiership Rugby", "Top 14", "Super Rugby"],
    "Excel Spreadsheet": ["School Rugby", "Club Invitational", "Regional Cup"],
  },
  Cricket: {
    API: ["IPL", "World Test Championship", "The Hundred", "Champions Trophy"],
    "Database (MySQL)": ["CSA T20", "Big Bash League", "County Championship"],
    "Excel Spreadsheet": ["Local Premier League", "Academy Tournament", "Friendly Series"],
  },
};

const BASE_URL = "http://localhost:8080";

function getTeamName(match, side) {
  if (side === "home") {
    return (
      match.homeTeamName ||
      match.home_team_name ||
      match.homeTeam?.name ||
      match.home?.name ||
      match.teamAName ||
      match.teamA?.name ||
      match.team1?.name ||
      "Home Team"
    );
  }

  return (
    match.awayTeamName ||
    match.away_team_name ||
    match.awayTeam?.name ||
    match.away?.name ||
    match.teamBName ||
    match.teamB?.name ||
    match.team2?.name ||
    "Away Team"
  );
}

function getVenueName(match) {
  return (
    match.venueName ||
    match.venue_name ||
    match.venue?.name ||
    match.ground?.name ||
    match.location?.name ||
    "Venue TBC"
  );
}

function normalizeMatchResult(match, index) {
  const homeName = getTeamName(match, "home");
  const awayName = getTeamName(match, "away");
  const venueName = getVenueName(match);

  return {
    id: match.id || `${homeName}-${awayName}-${index}`,
    dateTime: match.dateTime || null,
    competitionId: match.competition?.id || null,
    competitionName: match.competition?.name || null,
    seasonId: match.season?.id || null,
    seasonName: match.season?.name || null,
    homeTeamId: match.homeTeam?.id || null,
    homeTeam: homeName,
    awayTeamId: match.awayTeam?.id || null,
    awayTeam: awayName,
    venueName,
    label: `${homeName} vs ${awayName}`,
    raw: match,
  };
}

export async function fetchRugbyMatchesByDate(fromDate, competitionId, seasonId) {
  const params = new URLSearchParams();
  params.append('from', fromDate);
  if (competitionId) params.append('compId', competitionId);
  if (seasonId) params.append('seasonId', seasonId);
  const endpoint = `${BASE_URL}/api/v1/sportscaption/matches/rugbyviz/search?${params.toString()}`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error(`Failed to load matches (${response.status})`);
  }

  const payload = await response.json();
  const rawMatches = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.matches)
      ? payload.matches
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  return rawMatches
    .map(normalizeMatchResult)
    .sort((a, b) => {
      if (!a.dateTime || !b.dateTime) {
        return 0;
      }
      return new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
    });
}

function buildGraphics(statsType, filterValue) {
  const cleanFilter = filterValue?.trim() || "General";
  return [
    {
      id: "g-1",
      name: `${statsType} Score Summary`,
      type: "Full Screen",
      description: `Primary score board for ${cleanFilter}`,
    },
    {
      id: "g-2",
      name: `${statsType} Team Comparison`,
      type: "Lower Third",
      description: `Head-to-head comparison focused on ${cleanFilter}`,
    },
    {
      id: "g-3",
      name: `${statsType} Key Performer`,
      type: "Player Card",
      description: `Top performer visualization for ${cleanFilter}`,
    },
  ];
}

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

export async function getAvailableTournaments(sport, source) {
  if (!sport || !source) {
    return [];
  }

  if (sport === "Rugby" && source === "API") {
    const endpoint = `${BASE_URL}/api/v1/sportscaption/tournaments`;
    const response = await fetch(endpoint);

    if (!response.ok) {
      throw new Error(`Failed to load competitions from API (${response.status})`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data.map(normalizeApiCompetition) : [];
  }

  const fallback = tournamentData[sport]?.[source] || [];
  return fallback.map(normalizeFallbackCompetition);
}

export async function fetchGraphicsData({ sport, source, tournament, statsType, statsQuery }) {
  await new Promise((resolve) => setTimeout(resolve, 650));

  return {
    context: { sport, source, tournament, statsType, statsQuery },
    graphics: buildGraphics(statsType, statsQuery),
  };
}

export async function sendToMseServer(payload) {
  const mseEndpoint = import.meta.env.VITE_MSE_SERVER_URL || "http://localhost:8080/mse/graphics";

  try {
    const response = await fetch(mseEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`MSE server returned ${response.status}`);
    }

    const data = await response.json().catch(() => ({}));
    return { ok: true, endpoint: mseEndpoint, data };
  } catch (error) {
    return {
      ok: false,
      endpoint: mseEndpoint,
      error: error.message,
      fallback: "Connection to MSE server failed. Start your MSE endpoint or set VITE_MSE_SERVER_URL.",
    };
  }
}

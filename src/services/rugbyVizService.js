import { BASE_URL, apiClient, throwRequestError } from "./apiClient";

function sanitizeQueryUri(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function normalizeQueryUri(queryUri, queryEndpoint = "") {
  const sanitizedQueryUri = sanitizeQueryUri(queryUri);
  const sanitizedQueryEndpoint = sanitizeQueryUri(queryEndpoint);

  if (!sanitizedQueryUri) {
    return "";
  }

  if (/^https?:\/\//i.test(sanitizedQueryUri)) {
    const url = new URL(sanitizedQueryUri);
    return `${url.pathname}${url.search}`;
  }

  if (sanitizedQueryUri.startsWith("/")) {
    return sanitizedQueryUri;
  }

  const basePath = sanitizedQueryEndpoint || "/api/v1/sportscaption/rugbyviz/";
  const normalizedBasePath = (() => {
    if (/^https?:\/\//i.test(basePath)) {
      const url = new URL(basePath);
      return url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    }

    return basePath.endsWith("/") ? basePath : `${basePath}/`;
  })();

  const joinedPath = `${normalizedBasePath}${sanitizedQueryUri}`.replace(/\/+/g, "/");
  return joinedPath.startsWith("/") ? joinedPath : `/${joinedPath}`;
}

function normalizeRequestParams(params = {}, selectedDataType = null) {
  return {
    ...params,
    compId: params.compId ?? params.selectedCompetitionId,
    seasonId: params.seasonId ?? params.selectedSeasonId,
    matchId: params.matchId ?? params.selectedMatchId,
    type: params.type ?? selectedDataType?.type,
    dataType: params.dataType ?? selectedDataType?.dataType,
    playerId: params.playerId ?? params.selectedPlayerId,
    coverage: params.coverage ?? params.selectedCoverage,
    round: params.round ?? params.selectedRound,
    stat: params.stat ?? params.selectedStat,
  };
}

function getMissingRequiredParameters(queryUri, params = {}, requiredParameters = []) {
  const placeholderKeys = Array.from(queryUri.matchAll(/\{([^}]+)\}/g), (match) => match[1]);
  const requiredKeys = new Set([...requiredParameters, ...placeholderKeys]);

  return Array.from(requiredKeys).filter((key) => {
    const value = params[key];
    return value === undefined || value === null || value === "";
  });
}

function getPlaceholderKeys(queryUri) {
  return Array.from(queryUri.matchAll(/\{([^}]+)\}/g), (match) => match[1]);
}

function replacePathPlaceholders(value, params) {
  return value.replace(/\{([^}]+)\}/g, (_, key) => {
    const replacement = params[key];
    return replacement === undefined || replacement === null ? `{${key}}` : encodeURIComponent(String(replacement));
  });
}

function appendQueryParams(query, params, requiredParameters = [], excludedKeys = []) {
  const url = new URL(query, BASE_URL);
  const excludedKeySet = new Set(excludedKeys);
  const keysToAppend = new Set([
    ...requiredParameters,
    ...(params.compId && !excludedKeySet.has("compId") ? ["compId"] : []),
    ...(params.seasonId && !excludedKeySet.has("seasonId") ? ["seasonId"] : []),
    ...(params.matchId && !excludedKeySet.has("matchId") ? ["matchId"] : []),
    ...(params.type && !excludedKeySet.has("type") ? ["type"] : []),
    ...(params.dataType && !excludedKeySet.has("dataType") ? ["dataType"] : []),
    ...(params.playerId && !excludedKeySet.has("playerId") ? ["playerId"] : []),
    ...(params.coverage && !excludedKeySet.has("coverage") ? ["coverage"] : []),
    ...(params.round && !excludedKeySet.has("round") ? ["round"] : []),
    ...(params.stat && !excludedKeySet.has("stat") ? ["stat"] : []),
  ]);

  keysToAppend.forEach((key) => {
    const value = params[key];
    if (
      !excludedKeySet.has(key) &&
      value !== undefined &&
      value !== null &&
      value !== "" &&
      !url.searchParams.has(key)
    ) {
      url.searchParams.set(key, String(value));
    }
  });

  return `${url.pathname}${url.search}`;
}

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

function normalizeMatchStatsPayload(payload) {
  if (payload?.match) {
    return payload.match;
  }

  if (payload?.data) {
    return payload.data;
  }

  return payload;
}

function normalizeFixturesPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.fixtures)) {
    return payload.fixtures;
  }

  if (Array.isArray(payload?.matches)) {
    return payload.matches;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
}

function getTeamDisplayName(team, fallback) {
  return team?.shortName || team?.name || fallback;
}

function getFixtureScore(team) {
  return (
    team?.score?.finalScore ??
    team?.score?.ftScore ??
    team?.score?.currentScore ??
    team?.score?.htScore ??
    null
  );
}

function formatParts(date, timeZone, options) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    ...options,
  });

  return formatter.formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }

    return result;
  }, {});
}

function getFixtureDayKey(date, timeZone) {
  const { year, month, day } = formatParts(date, timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return `${year}-${month}-${day}`;
}

function formatFixtureDayLabel(date, timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatFixtureTimeLabel(date, timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function resolveUserTimeZone(options = {}) {
  if (typeof options.timeZone === "string" && options.timeZone.trim()) {
    return options.timeZone.trim();
  }

  const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return resolvedTimeZone || "UTC";
}

function normalizeFixtureEntry(fixture, index, timeZone) {
  const parsedDate = fixture?.dateTime ? new Date(fixture.dateTime) : null;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const dayKey = getFixtureDayKey(parsedDate, timeZone);
  const homeTeamName = getFixtureDisplayName(fixture?.homeTeam, "Home Team");
  const awayTeamName = getFixtureDisplayName(fixture?.awayTeam, "Away Team");
  const homeScore = getFixtureScore(fixture?.homeTeam);
  const awayScore = getFixtureScore(fixture?.awayTeam);

  return {
    id: String(fixture?.id ?? `fixture-${index + 1}`),
    dateTime: fixture.dateTime,
    dayKey,
    dayLabel: formatFixtureDayLabel(parsedDate, timeZone),
    timeLabel: formatFixtureTimeLabel(parsedDate, timeZone),
    homeScore,
    awayScore,
    competitionName: fixture?.competition?.name || fixture?.competition?.seasonName || "Competition",
    seasonName: fixture?.season?.name || "Season",
    homeTeamName,
    awayTeamName,
    label: `${homeTeamName} vs ${awayTeamName}`,
    venueName: fixture?.venue?.name || "Venue TBC",
    roundLabel: fixture?.title ? `Round ${fixture.title}` : fixture?.round ? `Round ${fixture.round}` : "",
    scoreLabel:
      homeScore === null && awayScore === null
        ? ""
        : `${homeScore ?? "-"} - ${awayScore ?? "-"}`,
    statusLabel: fixture?.matchStatus || fixture?.period || "fixture",
    raw: fixture,
  };
}

function getFixtureDisplayName(team, fallback) {
  return getTeamDisplayName(team, fallback);
}

function buildGroupedFixtureDays(fixtures) {
  const groupedDays = new Map();

  fixtures.forEach((fixture) => {
    if (!groupedDays.has(fixture.dayKey)) {
      groupedDays.set(fixture.dayKey, {
        dayKey: fixture.dayKey,
        dayLabel: fixture.dayLabel,
        fixtures: [],
      });
    }

    groupedDays.get(fixture.dayKey).fixtures.push(fixture);
  });

  return Array.from(groupedDays.values());
}

function hasFixtureScore(fixture) {
  return fixture.homeScore !== null || fixture.awayScore !== null;
}

function getRelativeDayKey(referenceDate, timeZone, dayOffset) {
  const shiftedDate = new Date(referenceDate);
  shiftedDate.setUTCDate(shiftedDate.getUTCDate() + dayOffset);
  return getFixtureDayKey(shiftedDate, timeZone);
}

function filterFixturesByView(fixtures, referenceDayKey, view, options = {}) {
  if (view === "results") {
    const earliestAllowedDayKey = getRelativeDayKey(options.referenceDate, options.timeZone, -4);

    return fixtures.filter(
      (fixture) =>
        hasFixtureScore(fixture) &&
        fixture.dayKey <= referenceDayKey &&
        fixture.dayKey >= earliestAllowedDayKey
    );
  }

  return fixtures.filter((fixture) => !hasFixtureScore(fixture) && fixture.dayKey >= referenceDayKey);
}

export class RugbyVizQueryWorker {
  constructor(client = apiClient) {
    this.client = client;
  }

  async getDataTypes() {
    const payload = await this.client.getJson(
      "/api/v1/sportscaption/rugbyviz/data-types",
      "Failed to load rugby data types"
    );

    return {
      source: payload?.source || "",
      queryEndpoint: payload?.queryEndpoint || "",
      items: Array.isArray(payload?.items)
        ? payload.items.map((item) => ({
            ...item,
            queryUri: normalizeQueryUri(item?.queryUri, payload?.queryEndpoint || ""),
          }))
        : [],
    };
  }

  async getSelectedData(selectedDataType, params = {}) {
    if (!selectedDataType?.queryUri) {
      throw new Error("Selected data type is missing a query URI.");
    }

    const normalizedParams = normalizeRequestParams(params, selectedDataType);
    const normalizedQueryUri = normalizeQueryUri(selectedDataType.queryUri);
    const placeholderKeys = getPlaceholderKeys(normalizedQueryUri);
    const missingParameters = getMissingRequiredParameters(
      normalizedQueryUri,
      normalizedParams,
      selectedDataType.requiredParameters
    );

    if (missingParameters.length) {
      throw new Error(`Missing required parameters for the selected data type: ${missingParameters.join(", ")}`);
    }

    let resolvedQuery = "";

    try {
      resolvedQuery = appendQueryParams(
        replacePathPlaceholders(normalizedQueryUri, normalizedParams),
        normalizedParams,
        selectedDataType.requiredParameters,
        placeholderKeys
      );
    } catch {
      throw new Error(`Invalid query URI for the selected data type: ${normalizedQueryUri}`);
    }

    if (/\{[^}]+\}/.test(resolvedQuery)) {
      throw new Error("Missing required parameters for the selected data type.");
    }

    const response = await this.client.request(resolvedQuery);
    if (!response.ok) {
      await throwRequestError(response, `Failed to load selected data (${response.status})`);
    }

    return response.json();
  }
}

export class RugbyVizMatchWorker {
  constructor(client = apiClient) {
    this.client = client;
  }

  async fetchMatchesByDate(fromDate, competitionId, seasonId) {
    const params = new URLSearchParams();
    params.append("from", fromDate);
    if (competitionId) {
      params.append("compId", competitionId);
    }
    if (seasonId) {
      params.append("seasonId", seasonId);
    }

    const payload = await this.client.getJson(
      `/api/v1/sportscaption/matches/rugbyviz/search?${params.toString()}`,
      "Failed to load matches"
    );

    const rawMatches = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.matches)
        ? payload.matches
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

    return rawMatches.map(normalizeMatchResult).sort((a, b) => {
      if (!a.dateTime || !b.dateTime) {
        return 0;
      }

      return new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
    });
  }

  async fetchMatchStats(matchId, options = {}) {
    if (!matchId) {
      throw new Error("A match ID is required to load match statistics.");
    }

    const apiUrl = new URL(`${BASE_URL}/api/v1/sportscaption/matches/rugbyviz/stats`);
    apiUrl.searchParams.set("matchId", matchId);

    const response = await fetch(apiUrl, {
      signal: options.signal,
    });

    if (!response.ok) {
      await throwRequestError(response, `Failed to load match statistics (${response.status})`);
    }

    return normalizeMatchStatsPayload(await response.json());
  }
}

export class RugbyVizFixturesWorker {
  getFixturesByDay(payload, options = {}) {
    const referenceDate = options.referenceDate instanceof Date ? options.referenceDate : new Date();
    const userTimeZone = resolveUserTimeZone(options);
    const referenceDayKey = getFixtureDayKey(referenceDate, userTimeZone);
    const view = options.view === "results" ? "results" : "fixtures";

    const normalizedFixtures = normalizeFixturesPayload(payload)
      .map((fixture, index) => normalizeFixtureEntry(fixture, index, userTimeZone))
      .filter(Boolean)
      .filter((fixture) =>
        filterFixturesByView([fixture], referenceDayKey, view, {
          referenceDate,
          timeZone: userTimeZone,
        }).length
      )
      .sort((left, right) => new Date(left.dateTime).getTime() - new Date(right.dateTime).getTime());

    return {
      competition: normalizedFixtures[0]?.raw?.competition ?? null,
      season: normalizedFixtures[0]?.raw?.season ?? null,
      userTimeZone,
      view,
      fixtureDays: buildGroupedFixtureDays(normalizedFixtures),
    };
  }

  getUpcomingFixturesByDay(payload, options = {}) {
    return this.getFixturesByDay(payload, {
      ...options,
      view: "fixtures",
    });
  }
}

export const rugbyVizQueryWorker = new RugbyVizQueryWorker();
export const rugbyVizMatchWorker = new RugbyVizMatchWorker();
export const rugbyVizFixturesWorker = new RugbyVizFixturesWorker();

export function getRugbyVizDataTypes() {
  return rugbyVizQueryWorker.getDataTypes();
}

export function getRugbyVizSelectedData(selectedDataType, params = {}) {
  return rugbyVizQueryWorker.getSelectedData(selectedDataType, params);
}

export function fetchRugbyMatchesByDate(fromDate, competitionId, seasonId) {
  return rugbyVizMatchWorker.fetchMatchesByDate(fromDate, competitionId, seasonId);
}

export function fetchRugbyMatchStats(matchId, options = {}) {
  return rugbyVizMatchWorker.fetchMatchStats(matchId, options);
}

export function getUpcomingFixturesByDay(payload, options = {}) {
  return rugbyVizFixturesWorker.getUpcomingFixturesByDay(payload, options);
}

export function getFixturesByDay(payload, options = {}) {
  return rugbyVizFixturesWorker.getFixturesByDay(payload, options);
}
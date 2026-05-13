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

export const rugbyVizQueryWorker = new RugbyVizQueryWorker();
export const rugbyVizMatchWorker = new RugbyVizMatchWorker();

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
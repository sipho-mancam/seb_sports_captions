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
  const normalizedBasePath = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const url = new URL(sanitizedQueryUri, new URL(normalizedBasePath, BASE_URL));

  return `${url.pathname}${url.search}`;
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

export async function getRugbyVizDataTypes() {
  const endpoint = `${BASE_URL}/api/v1/sportscaption/rugbyviz/data-types`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error(`Failed to load rugby data types (${response.status})`);
  }

  const payload = await response.json();

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

function replacePathPlaceholders(value, params) {
  return value.replace(/\{([^}]+)\}/g, (_, key) => {
    const replacement = params[key];
    return replacement === undefined || replacement === null ? `{${key}}` : encodeURIComponent(String(replacement));
  });
}

function appendQueryParams(query, params, requiredParameters = []) {
  const url = new URL(query, BASE_URL);
  const keysToAppend = new Set([
    ...requiredParameters,
    ...(params.compId ? ["compId"] : []),
    ...(params.seasonId ? ["seasonId"] : []),
    ...(params.matchId ? ["matchId"] : []),
    ...(params.type ? ["type"] : []),
    ...(params.dataType ? ["dataType"] : []),
    ...(params.playerId ? ["playerId"] : []),
    ...(params.coverage ? ["coverage"] : []),
    ...(params.round ? ["round"] : []),
    ...(params.stat ? ["stat"] : []),
  ]);

  keysToAppend.forEach((key) => {
    const value = params[key];
    if (value !== undefined && value !== null && value !== "" && !url.searchParams.has(key)) {
      url.searchParams.set(key, String(value));
    }
  });

  return `${url.pathname}${url.search}`;
}

export async function getRugbyVizSelectedData(selectedDataType, params = {}) {
  if (!selectedDataType?.queryUri) {
    throw new Error("Selected data type is missing a query URI.");
  }

  const normalizedParams = normalizeRequestParams(params, selectedDataType);
  const normalizedQueryUri = normalizeQueryUri(selectedDataType.queryUri);
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
      selectedDataType.requiredParameters
    );
  } catch {
    throw new Error(`Invalid query URI for the selected data type: ${normalizedQueryUri}`);
  }

  if (/\{[^}]+\}/.test(resolvedQuery)) {
    throw new Error("Missing required parameters for the selected data type.");
  }

  const response = await fetch(`${BASE_URL}${resolvedQuery}`);
  if (!response.ok) {
    throw new Error(`Failed to load selected data (${response.status})`);
  }

  return response.json();
}

function pickFirstArray(payload, keys) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  return [];
}

function getLinkHref(entry, preferredRels = ["self", "alternate", "edit", "related"]) {
  const links = Array.isArray(entry?.links) ? entry.links : [];

  for (const rel of preferredRels) {
    const matchingLink = links.find((link) => link?.href && link?.rel === rel);
    if (matchingLink?.href) {
      return matchingLink.href;
    }
  }

  return links.find((link) => link?.href)?.href || null;
}

function getEntryUri(entry) {
  return (
    entry?.uri ||
    entry?.url ||
    entry?.href ||
    entry?.bucketUrl ||
    entry?.entryUrl ||
    entry?.link ||
    getLinkHref(entry) ||
    null
  );
}

function getEntryLabel(entry, fallback = "") {
  return entry?.title || entry?.name || entry?.displayName || fallback;
}

function normalizeShow(showEntry, index) {
  return {
    id: showEntry?.id || getEntryUri(showEntry) || `show-${index + 1}`,
    name: getEntryLabel(showEntry, `Show ${index + 1}`),
    uri: getEntryUri(showEntry),
    raw: showEntry,
  };
}

function getTemplateBucketUrl(payload) {
  if (typeof payload?.buckets?.templates === "string" && payload.buckets.templates) {
    return payload.buckets.templates;
  }

  const buckets = pickFirstArray(payload, ["buckets", "bucketEntries", "entries", "items", "data"]);
  const templateBucket = buckets.find((bucketEntry) => {
    const label = getEntryLabel(bucketEntry).toLowerCase();
    return label.includes("template");
  });

  return getEntryUri(templateBucket);
}

function normalizeTemplate(template, index, showName = "", bucketName = "") {
  const templateTitle = template?.title || template?.template?.title || template?.raw?.title;

  return {
    id: template.id || template.name || template.templateName || getEntryUri(template) || `template-${index + 1}`,
    name:
      templateTitle ||
      template.name ||
      template.templateName ||
      template.displayName ||
      `Template ${index + 1}`,
    uri: getEntryUri(template),
    showName,
    bucketName,
    raw: template,
  };
}

function normalizePreparedTemplate(payload, fallbackTemplate) {
  const templateTitle =
    payload?.title ||
    payload?.template?.title ||
    payload?.raw?.title ||
    fallbackTemplate?.title ||
    fallbackTemplate?.raw?.title;

  return {
    templateName:
      templateTitle ||
      payload?.templateName ||
      payload?.name ||
      payload?.template?.name ||
      fallbackTemplate?.templateName ||
      fallbackTemplate?.name ||
      "Template",
    elementCollectionUri:
      payload?.elementCollectionUri || payload?.element_collection_uri || payload?.collectionUri || "",
    modelUri: payload?.modelUri || payload?.model_uri || payload?.pageModelUri || "",
    mapping:
      payload?.mapping || payload?.template || payload?.fields || payload?.fieldMapping || payload || {},
    raw: payload,
  };
}
function extractValue(source, key, index = 0) {
  if (source === null || source === undefined) {
    return "";
  }

  if (typeof key !== "string") {
    return source;
  }

  if (Array.isArray(source)) {
    const item = source[index];
    if (item === undefined) {
      return "";
    }
    if (item && typeof item === "object") {
      return item[key] ?? item.value ?? "";
    }
    return item;
  }

  if (typeof source === "object") {
    if (key in source) {
      return source[key];
    }

    const dottedValue = key.split(".").reduce((current, segment) => current?.[segment], source);
    if (dottedValue !== undefined) {
      return dottedValue;
    }
  }

  return source;
}

function setFieldValue(fieldValues, fieldId, value) {
  if (fieldId === null || fieldId === undefined || fieldId === "") {
    return;
  }

  fieldValues[String(fieldId)] = value ?? "";
}

export function buildFieldValuesFromTemplate(mapping, selectedData) {
  const fieldValues = {};

  Object.entries(mapping || {}).forEach(([key, config]) => {
    if (typeof config === "number" || typeof config === "string") {
      setFieldValue(fieldValues, config, extractValue(selectedData, key));
      return;
    }

    if (!config || typeof config !== "object") {
      return;
    }

    if (config.field && Array.isArray(config.scores)) {
      const delimiter = config.delimiter || " ";
      const combinedValue = config.scores
        .map((scoreKey, index) => extractValue(selectedData, scoreKey, index))
        .filter((value) => value !== "")
        .join(delimiter);
      setFieldValue(fieldValues, config.field, combinedValue);
      return;
    }

    if (Array.isArray(config.list) && Array.isArray(config.list_item)) {
      const sourceList = extractValue(selectedData, key);
      const rows = Array.isArray(sourceList) ? sourceList : [];

      config.list.forEach((fieldRow, rowIndex) => {
        if (!Array.isArray(fieldRow)) {
          return;
        }

        fieldRow.forEach((fieldId, columnIndex) => {
          const sourceItem = rows[rowIndex];
          const sourceKey = config.list_item[columnIndex];
          let value = "";

          if (Array.isArray(sourceItem)) {
            value = sourceItem[columnIndex] ?? "";
          } else if (sourceItem && typeof sourceItem === "object") {
            value = sourceItem[sourceKey] ?? sourceItem.value ?? "";
          } else if (sourceItem !== undefined) {
            value = sourceItem;
          }

          setFieldValue(fieldValues, fieldId, value);
        });
      });
    }
  });

  return fieldValues;
}

export async function getGraphicShows() {
  const endpoint = `${BASE_URL}/api/mse/shows`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error(`Failed to load MSE shows (${response.status})`);
  }

  const showsPayload = await response.json();
  const shows = pickFirstArray(showsPayload, ["shows", "entries", "showEntries", "items", "data"]);

  return shows.map((showEntry, index) => normalizeShow(showEntry, index));
}

export async function getGraphicTemplates(showEntry) {
  if (!showEntry) {
    return [];
  }

  const bucketResponse = await fetch(`${BASE_URL}/api/mse/shows/buckets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ showEntry }),
  });

  if (!bucketResponse.ok) {
    throw new Error(`Failed to discover buckets (${bucketResponse.status})`);
  }

  const bucketPayload = await bucketResponse.json();
  const templateBucketUrl = getTemplateBucketUrl(bucketPayload);

  if (!templateBucketUrl) {
    return [];
  }

  const bucketEntriesResponse = await fetch(
    `${BASE_URL}/api/mse/buckets/entries?${new URLSearchParams({ bucketUrl: templateBucketUrl }).toString()}`
  );

  if (!bucketEntriesResponse.ok) {
    throw new Error(`Failed to load bucket entries (${bucketEntriesResponse.status})`);
  }

  const bucketEntriesPayload = await bucketEntriesResponse.json();
  const entries = pickFirstArray(bucketEntriesPayload, ["entries", "bucketEntries", "items", "data"]);

  return entries.map((entry, index) =>
    normalizeTemplate(entry, index, getEntryLabel(showEntry), "templates")
  );
}

export async function getGraphicManifest(manifestId) {
  if (!manifestId) {
    throw new Error("Manifest ID is required.");
  }

  const response = await fetch(
    `${BASE_URL}/api/v1/sportscaption/graphics/manifests/${encodeURIComponent(manifestId)}`
  );

  if (!response.ok) {
    throw new Error(`Failed to load graphic manifest (${response.status})`);
  }

  return response.json();
}

export async function prepareGraphicTemplate(templateEntry) {
  const response = await fetch(`${BASE_URL}/api/mse/templates/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateEntry }),
  });

  if (!response.ok) {
    throw new Error(`Failed to prepare template (${response.status})`);
  }

  return normalizePreparedTemplate(await response.json(), templateEntry);
}

export async function createGraphicPage({ preparedTemplate, fieldValues }) {
  const response = await fetch(`${BASE_URL}/api/mse/pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      elementCollectionUri: preparedTemplate.elementCollectionUri,
      modelUri: preparedTemplate.modelUri,
      fieldValues,
      templateName: preparedTemplate.templateName,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create page (${response.status})`);
  }

  const payload = await response.json();
  return {
    name: payload?.pageName || payload?.name || payload?.templateName || preparedTemplate.templateName,
    uri: payload?.pageUri || payload?.uri || payload?.url || "",
    raw: payload,
  };
}

function normalizeProfile(profile) {
  if (!profile) {
    return null;
  }

  return {
    name: profile.name || "",
    graphicManifestPath: profile.graphic_manifest_path || profile.graphicManifestPath || "",
    mseUrl: profile.mse_url || profile.mseUrl || "",
  };
}

export async function getActiveProfile() {
  const endpoint = `${BASE_URL}/api/v1/sportscaption/profiles/active`;
  const response = await fetch(endpoint);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to load active profile (${response.status})`);
  }

  return normalizeProfile(await response.json());
}

export async function getProfiles() {
  const endpoint = `${BASE_URL}/api/v1/sportscaption/profiles`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error(`Failed to load profiles (${response.status})`);
  }

  const payload = await response.json();
  return Array.isArray(payload) ? payload.map(normalizeProfile).filter(Boolean) : [];
}

export async function createProfile(profile) {
  const endpoint = `${BASE_URL}/api/v1/sportscaption/profiles`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: profile.name,
      graphic_manifest_path: profile.graphic_manifest_path,
      mse_url: profile.mse_url,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create profile (${response.status})`);
  }

  return normalizeProfile(await response.json());
}

export async function setActiveProfile(profileName) {
  const endpoint = `${BASE_URL}/api/v1/sportscaption/profiles/active`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: profileName }),
  });

  if (!response.ok) {
    throw new Error(`Failed to set active profile (${response.status})`);
  }

  return normalizeProfile(await response.json());
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

export async function sendToMseServer(payload, mseUrlOverride) {
  const mseEndpoint = mseUrlOverride || import.meta.env.VITE_MSE_SERVER_URL || "http://localhost:8080/mse/graphics";

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



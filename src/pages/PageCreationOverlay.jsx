import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { useAppFlow } from "../context/AppFlowContext";
import {
  buildFieldValuesFromTemplate,
  createGraphicPage,
  getGraphicManifest,
  getActiveProfileStatsPageDefaults,
  getGraphicShows,
  getGraphicTemplates,
  getRugbyVizSelectedData,
  prepareGraphicTemplate,
} from "../services/graphicsService";

function stringifyJson(value) {
  return JSON.stringify(value, null, 2);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildFieldPath(segments) {
  return segments.reduce((path, segment) => {
    if (segment === "[]") {
      return `${path}[]`;
    }

    return path ? `${path}.${segment}` : segment;
  }, "");
}

function parseFieldPath(path) {
  return path.split(".").flatMap((segment) => {
    if (!segment) {
      return [];
    }

    if (segment.endsWith("[]")) {
      const baseSegment = segment.slice(0, -2);
      return baseSegment ? [baseSegment, "[]"] : ["[]"];
    }

    return [segment];
  });
}

function buildSelectionTree(paths) {
  return paths.reduce((tree, path) => {
    let currentNode = tree;

    parseFieldPath(path).forEach((segment) => {
      if (!currentNode[segment]) {
        currentNode[segment] = {};
      }

      currentNode = currentNode[segment];
    });

    currentNode.__leaf = true;
    return tree;
  }, {});
}

function filterValueBySelection(value, selectionTree) {
  if (!selectionTree) {
    return undefined;
  }

  if (Array.isArray(value)) {
    if (selectionTree.__leaf) {
      return value;
    }

    const itemSelection = selectionTree["[]"];
    if (!itemSelection) {
      return undefined;
    }

    return value
      .map((item) => filterValueBySelection(item, itemSelection))
      .filter((item) => item !== undefined);
  }

  if (isRecord(value)) {
    if (selectionTree.__leaf && Object.keys(selectionTree).length === 1) {
      return value;
    }

    const filteredObject = Object.entries(selectionTree).reduce((result, [key, childSelection]) => {
      if (key === "__leaf") {
        return result;
      }

      const filteredChild = filterValueBySelection(value[key], childSelection);
      if (filteredChild !== undefined) {
        result[key] = filteredChild;
      }

      return result;
    }, {});

    if (Object.keys(filteredObject).length) {
      return filteredObject;
    }

    return selectionTree.__leaf ? value : undefined;
  }

  return selectionTree.__leaf ? value : undefined;
}

function getNestedValue(source, path) {
  if (!path) {
    return source;
  }

  return path.split(".").reduce((current, segment) => current?.[segment], source);
}

function setNestedValue(target, path, value) {
  const segments = path.split(".").filter(Boolean);
  if (!segments.length) {
    return target;
  }

  let current = target;

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }

    if (!isRecord(current[segment])) {
      current[segment] = {};
    }

    current = current[segment];
  });

  return target;
}

function humanizeLabel(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatSelectableStatLabel(label) {
  return String(label || "")
}

function formatMatchStatsFieldLabel(label) {
  return String(label || "")
    .replace(/^percentage\b\s*/i, "% ")
    .replace(/^percent\b\s*/i, "\\% ")
    .replace(/\bpercent\b/gi, "\\%");
}

function formatStatDescription(path) {
  const segments = String(path || "").split(".").filter(Boolean);
  return formatSelectableStatLabel(humanizeLabel(segments[segments.length - 1] || path || ""));
}

function formatHeadToHeadSegmentLabel(segment, selectedData) {
  const homeTeamName = selectedData?.teams?.homeTeam?.name || "Home Team";
  const awayTeamName = selectedData?.teams?.awayTeam?.name || "Away Team";

  const mappedLabels = {
    homeTeam: homeTeamName,
    awayTeam: awayTeamName,
    homeTeamWins: `${homeTeamName} Wins`,
    awayTeamWins: `${awayTeamName} Wins`,
    homeTeamWinPercentage: `${homeTeamName} Win Percentage`,
    awayTeamWinPercentage: `${awayTeamName} Win Percentage`,
  };

  return mappedLabels[segment] || humanizeLabel(segment);
}

function formatHeadToHeadSummaryLabel(path, selectedData) {
  const segments = String(path || "").split(".").filter(Boolean);

  if (!segments.length) {
    return "";
  }

  if (segments.length === 1) {
    return formatSelectableStatLabel(formatHeadToHeadSegmentLabel(segments[0], selectedData));
  }

  const parentLabel = segments
    .slice(0, -1)
    .map((segment) => formatHeadToHeadSegmentLabel(segment, selectedData))
    .join(" ");
  const statLabel = formatHeadToHeadSegmentLabel(segments[segments.length - 1], selectedData);

  return formatSelectableStatLabel(`${parentLabel}: ${statLabel}`);
}

function formatListItemValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value).trim().replace(/%$/u, "").trim();
}

function collectTeamStatPaths(homeStats, awayStats, parentPath = "", paths = new Set()) {
  const homeRecord = isRecord(homeStats) ? homeStats : null;
  const awayRecord = isRecord(awayStats) ? awayStats : null;
  const keys = new Set([
    ...Object.keys(homeRecord || {}),
    ...Object.keys(awayRecord || {}),
  ]);

  keys.forEach((key) => {
    const nextPath = parentPath ? `${parentPath}.${key}` : key;
    const homeValue = homeRecord?.[key];
    const awayValue = awayRecord?.[key];

    if (isRecord(homeValue) || isRecord(awayValue)) {
      collectTeamStatPaths(homeValue, awayValue, nextPath, paths);
      return;
    }

    if (homeValue !== undefined || awayValue !== undefined) {
      paths.add(nextPath);
    }
  });

  return Array.from(paths);
}

function buildTeamStatsList(selectedData, selectedStatPaths) {
  const homeStats = selectedData?.homeTeam?.teamStats || {};
  const awayStats = selectedData?.awayTeam?.teamStats || {};

  return selectedStatPaths.map((path) => [
    formatListItemValue(getNestedValue(homeStats, path)),
    formatStatDescription(path),
    formatListItemValue(getNestedValue(awayStats, path)),
  ]);
}

function isMatchStatsPayload(selectedData) {
  return Boolean(selectedData?.homeTeam?.teamStats || selectedData?.awayTeam?.teamStats);
}

function getDefaultMatchStatSuffix(path) {
  return "";
}

function formatMatchStatValue(value) {
  if (value === null || value === undefined || value === "" || value === "-") {
    return "0";
  }

  const normalizedString = String(value).trim().replace(/%$/u, "").trim();
  if (!normalizedString || normalizedString === "-") {
    return "0";
  }

  const numericValue = Number(normalizedString.replace(/,/g, ""));
  if (Number.isFinite(numericValue)) {
    return String(Math.round(numericValue));
  }

  return normalizedString;
}

function getMatchStatSelectableItems(selectedData, selectedStatPaths) {
  const homeStats = selectedData?.homeTeam?.teamStats || {};
  const awayStats = selectedData?.awayTeam?.teamStats || {};

  return selectedStatPaths.map((path) => ({
    awayValue: formatMatchStatValue(getNestedValue(awayStats, path)),
    defaultSuffix: getDefaultMatchStatSuffix(path),
    homeValue: formatMatchStatValue(getNestedValue(homeStats, path)),
    id: path,
    label: formatStatDescription(path),
    path,
  }));
}

function isPlayerStatsDataType(selectedDataType) {
  const combinedLabel = `${selectedDataType?.dataType || ""} ${selectedDataType?.type || ""}`.toLowerCase();
  return combinedLabel.includes("player") && combinedLabel.includes("stat") && !combinedLabel.includes("top 10") && !combinedLabel.includes("top10");
}

function collectPlayerStatPaths(stats, parentPath = "", paths = new Set()) {
  const statsRecord = isRecord(stats) ? stats : null;

  Object.keys(statsRecord || {}).forEach((key) => {
    const nextPath = parentPath ? `${parentPath}.${key}` : key;
    const value = statsRecord?.[key];

    if (isRecord(value)) {
      collectPlayerStatPaths(value, nextPath, paths);
      return;
    }

    if (value !== undefined) {
      paths.add(nextPath);
    }
  });

  return Array.from(paths);
}

function getPlayerStatSelectableItems(player, selectedStatPaths) {
  const playerStats = player?.stats || {};

  return selectedStatPaths.map((path) => ({
    defaultSuffix: getDefaultMatchStatSuffix(path),
    id: path,
    label: formatStatDescription(path),
    path,
    value: formatMatchStatValue(getNestedValue(playerStats, path)),
  }));
}

function normalizeStatLabel(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getStatSearchScore(label, normalizedQuery) {
  if (!normalizedQuery) {
    return 0;
  }

  const normalizedLabel = normalizeStatLabel(label);
  if (!normalizedLabel) {
    return null;
  }

  if (normalizedLabel === normalizedQuery) {
    return 0;
  }

  if (normalizedLabel.startsWith(normalizedQuery)) {
    return 1;
  }

  if (normalizedLabel.split(" ").some((word) => word.startsWith(normalizedQuery))) {
    return 2;
  }

  if (normalizedLabel.includes(normalizedQuery)) {
    return 3;
  }

  return null;
}

function getRankedStatItemsByQuery(items, query) {
  const normalizedQuery = normalizeStatLabel(query);
  if (!normalizedQuery) {
    return items;
  }

  return items
    .map((item, index) => ({
      index,
      item,
      score: getStatSearchScore(item.label, normalizedQuery),
    }))
    .filter((entry) => entry.score !== null)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((entry) => entry.item);
}

function getAllStatsPageDefaultDescriptions(statsPageDefaults) {
  return Object.values(statsPageDefaults || {}).flatMap((pageDefaults) =>
    Array.isArray(pageDefaults) ? pageDefaults : []
  );
}

function resolveMatchStatDefaultsForPage(
  matchStatItems,
  statsPageDefaults,
  selectedStatsPageKey,
  selectionLimit,
  options = {}
) {
  const defaultDescriptions = options.useAllPages
    ? getAllStatsPageDefaultDescriptions(statsPageDefaults)
    : Array.isArray(statsPageDefaults?.[selectedStatsPageKey])
      ? statsPageDefaults[selectedStatsPageKey]
      : [];

  if (!defaultDescriptions.length) {
    return {
      orderedItems: matchStatItems,
      selectedPaths: matchStatItems.slice(0, selectionLimit).map((item) => item.path),
    };
  }

  const itemsByLabel = matchStatItems.reduce((result, item) => {
    const normalizedLabel = normalizeStatLabel(item.label);
    if (!result.has(normalizedLabel)) {
      result.set(normalizedLabel, []);
    }

    result.get(normalizedLabel).push(item);
    return result;
  }, new Map());

  const selectedItems = [];
  defaultDescriptions.forEach((description) => {
    const matchingItems = itemsByLabel.get(normalizeStatLabel(description)) || [];
    const nextItem = matchingItems.find((item) => !selectedItems.some((selectedItem) => selectedItem.path === item.path));

    if (nextItem) {
      selectedItems.push(nextItem);
    }
  });

  const orderedItems = [
    ...selectedItems,
    ...matchStatItems.filter((item) => !selectedItems.some((selectedItem) => selectedItem.path === item.path)),
  ];

  return {
    orderedItems,
    selectedPaths: orderedItems.slice(0, selectionLimit).filter((item) => selectedItems.includes(item)).map((item) => item.path),
  };
}

function buildManifestLikePlayerStatsData(selectedData, selection, selectedStatPaths, options = {}) {
  const selectedPlayer = selection?.player?.raw || null;
  const teamOption = selection?.teamOption || null;

  if (!selectedPlayer || !teamOption) {
    return null;
  }

  const manifest = options.manifest;
  const suffixByPath = options.suffixByPath || {};
  const selectionLimit = getMatchStatsSelectionLimit(manifest);
  const team = teamOption.teamData?.team || {};
  const teamName = getTeamNameValue(team);
  const teamImageName = getTeamImageNameValue(team);
  const playerName = getPlayerDisplayName(selectedPlayer);
  const positionName = selectedPlayer?.position?.name ? humanizeLabel(selectedPlayer.position.name) : "";
  const pageStateKeys = getMatchStatsSectionItemKeys(manifest?.page_state, ["value"]);
  const statisticsKeys = getMatchStatsSectionItemKeys(manifest?.stats_list, ["stat_label", "stat_value"]);
  const playerHeaderKeys = getMatchStatsSectionItemKeys(manifest?.player_header, []);
  const jerseyNumberKeys = getMatchStatsSectionItemKeys(manifest?.jersey_number, ["jersey_number"]);
  const selectedItems = getPlayerStatSelectableItems(selectedPlayer, selectedStatPaths).slice(0, selectionLimit);
  const filteredStats = selectedStatPaths.reduce((result, path) => {
    setNestedValue(result, path, getNestedValue(selectedPlayer?.stats || {}, path));
    return result;
  }, {});

  const resolveHeaderValue = (itemKey) => {
    if (typeof itemKey === "string" && itemKey.startsWith("#img:")) {
      return buildImageManifestPayload(itemKey, {
        playerName,
        teamName: teamImageName,
      });
    }

    const normalizedKey = String(itemKey || "").trim().toLowerCase();

    if (["player_name", "player", "display_name", "displayname", "known_name", "knownname", "full_name", "fullname"].includes(normalizedKey)) {
      return playerName;
    }

    if (["team_name", "team"].includes(normalizedKey)) {
      return teamName;
    }

    if (["team_logo", "logo"].includes(normalizedKey)) {
      return buildImageManifestPayload("#img:team_logo", { teamName: teamImageName });
    }

    if (["player_image", "playerimage", "image"].includes(normalizedKey)) {
      return buildImageManifestPayload("#img:team:player", { playerName, teamName: teamImageName });
    }

    if (["jersey_number", "shirt_number", "shirtnumber"].includes(normalizedKey)) {
      return getPlayerShirtNumber(selectedPlayer) ?? "";
    }

    if (["position", "position_name", "positionname"].includes(normalizedKey)) {
      return positionName;
    }

    if (["title", "subtitle"].includes(normalizedKey)) {
      return "STATS";
    }

    return selectedPlayer?.[itemKey] ?? selectedPlayer?.position?.[itemKey] ?? team?.[itemKey] ?? "";
  };

  return {
    competition: selectedData?.competition ?? null,
    season: selectedData?.season ?? null,
    venue: selectedData?.venue ?? null,
    player: {
      ...selectedPlayer,
      stats: filteredStats,
    },
    player_image: buildImageManifestPayload("#img:team:player", { playerName, teamName: teamImageName }),
    player_name: playerName,
    position_name: positionName,
    page_state: {
      data: pageStateKeys.reduce((result, itemKey) => {
        result[itemKey] = itemKey === "value" ? getPageStateValue(selectedData) : "";
        return result;
      }, {}),
      item: pageStateKeys,
    },
    stats_list: {
      data: selectedItems.map((item) =>
        statisticsKeys.reduce((result, itemKey) => {
          const normalizedKey = String(itemKey || "").trim().toLowerCase();

          if (normalizedKey.includes("description") || normalizedKey.includes("label") || normalizedKey === "stat") {
            result[itemKey] = item.label;
          } else if (normalizedKey.includes("suffix")) {
            result[itemKey] = "";
          } else {
            result[itemKey] = appendMatchStatSuffix(item.value, suffixByPath[item.path] ?? item.defaultSuffix);
          }

          return result;
        }, {})
      ),
      list_item: statisticsKeys,
    },
    team,
    team_logo: buildImageManifestPayload("#img:team_logo", { teamName: teamImageName }),
    team_name: teamName,
    jersey_number: {
      data: jerseyNumberKeys.reduce((result, itemKey) => {
        result[itemKey] = getPlayerShirtNumber(selectedPlayer) ?? "";
        return result;
      }, {}),
      item: jerseyNumberKeys,
    },
    ...(playerHeaderKeys.length
      ? {
          player_header: {
            data: playerHeaderKeys.reduce((result, itemKey) => {
              result[itemKey] = resolveHeaderValue(itemKey);
              return result;
            }, {}),
            item: playerHeaderKeys,
          },
        }
      : {}),
  };
}

function notifyRequestError(message, fallbackMessage) {
  const resolvedMessage = message || fallbackMessage;
  window.alert(resolvedMessage);
  return resolvedMessage;
}

function getTeamLogoValue(team) {
  return team?.abbreviation || team?.shortName || team?.name || team?.id || "";
}

function getTeamBadgeValue(team) {
  return team?.abbreviation?.toUpperCase() || team?.shortName || team?.name || "";
}

function getTeamNameValue(team) {
  return team?.name || team?.shortName || "";
}

function getTeamImageNameValue(team) {
  return getTeamNameValue(team);
}

function buildImageManifestPayload(token, options = {}) {
  if (typeof token !== "string" || !token.startsWith("#img:")) {
    return "";
  }

  const descriptor = token.slice(5).trim();
  if (!descriptor) {
    return "";
  }

  const segments = descriptor.split(":").map((segment) => segment.trim()).filter(Boolean);
  const primaryToken = segments[0] || "";
  const secondaryToken = segments[1] || "";
  const homeTeamName = options.homeTeamName || "";
  const awayTeamName = options.awayTeamName || "";
  const homeCaptainName = options.homeCaptainName || "";
  const awayCaptainName = options.awayCaptainName || "";
  const teamName = options.teamName || "";
  const playerName = options.playerName || "";

  const resolveTeamName = () => {
    switch (primaryToken) {
      case "home_team_logo":
      case "home_team":
        return homeTeamName || teamName;
      case "away_team_logo":
      case "away_team":
        return awayTeamName || teamName;
      default:
        return teamName || homeTeamName || awayTeamName;
    }
  };

  const resolvedTeamName = resolveTeamName();
  if (!resolvedTeamName) {
    return "";
  }

  if (primaryToken === "home_captain_photo" && homeCaptainName) {
    return `#img:${homeTeamName || resolvedTeamName}:player:${homeCaptainName}`;
  }

  if (primaryToken === "away_captain_photo" && awayCaptainName) {
    return `#img:${awayTeamName || resolvedTeamName}:player:${awayCaptainName}`;
  }

  if (primaryToken.endsWith("_logo")) {
    return `#img:${resolvedTeamName}`;
  }

  if (["coach_photo", "player_photo", "player_image"].includes(primaryToken) && playerName) {
    return `#img:${resolvedTeamName}:player:${playerName}`;
  }

  if (secondaryToken === "player" && playerName) {
    return `#img:${resolvedTeamName}:player:${playerName}`;
  }

  return "";
}

function getTeamScoreValue(team) {
  return (
    team?.score?.finalScore ??
    team?.score?.currentScore ??
    team?.score?.ftScore ??
    team?.score?.htScore ??
    ""
  );
}

function getPeriodLabelValue(selectedData) {
  return humanizeLabel(selectedData?.period || selectedData?.matchStatus || "");
}

function getPageStateValue(selectedData) {
  return selectedData?.matchStatus || selectedData?.period || "";
}

function normalizeManifestKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/^#img:/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getManifestConfiguredItemKeys(config) {
  if (Array.isArray(config?.list_item) && config.list_item.length) {
    return config.list_item;
  }

  if (Array.isArray(config?.item) && config.item.length) {
    return config.item;
  }

  if (typeof config?.item === "string" && config.item.trim()) {
    return [config.item.trim()];
  }

  return [];
}

function getManifestConfiguredSections(manifest) {
  if (!isRecord(manifest)) {
    return [];
  }

  return Object.entries(manifest)
    .filter(([key, config]) => key !== "metadata" && isRecord(config))
    .map(([key, config]) => {
      const itemKeys = getManifestConfiguredItemKeys(config);
      const fieldRows = Array.isArray(config.fields) ? config.fields : [];
      const isList = Array.isArray(config.list_item) || (fieldRows.length > 0 && Array.isArray(fieldRows[0]));

      return {
        config,
        fieldRows,
        isList,
        itemKeys,
        key,
        normalizedKey: normalizeManifestKey(key),
      };
    })
    .filter((section) => section.itemKeys.length);
}

function findTeamCaptainPlayer(players) {
  return (
    (Array.isArray(players) ? players : []).find((player) => String(player?.captain || "").toLowerCase() === "true") ||
    findTeamPlayerByShirtNumber(players, 1) ||
    null
  );
}

function findTeamPlayerByShirtNumber(players, shirtNumber) {
  return (Array.isArray(players) ? players : []).find(
    (player) => Number(getPlayerShirtNumber(player)) === Number(shirtNumber)
  ) || null;
}

function buildMatchStatsCaptainPhotoData(selectedData, itemKeys) {
  const homeTeam = selectedData?.homeTeam?.team || {};
  const awayTeam = selectedData?.awayTeam?.team || {};
  const homePlayer = findTeamCaptainPlayer(selectedData?.homeTeam?.players);
  const awayPlayer = findTeamCaptainPlayer(selectedData?.awayTeam?.players);

  return itemKeys.reduce((result, itemKey) => {
    const normalizedKey = String(itemKey || "").trim().toLowerCase();
    const valueMap = {
      "#img:away_team:player_1": awayPlayer
        ? buildImageManifestPayload("#img:away_team:player", {
            awayTeamName: getTeamImageNameValue(awayTeam),
            playerName: getPlayerDisplayName(awayPlayer),
          })
        : "",
      "#img:home_team:player_1": homePlayer
        ? buildImageManifestPayload("#img:home_team:player", {
            homeTeamName: getTeamImageNameValue(homeTeam),
            playerName: getPlayerDisplayName(homePlayer),
          })
        : "",
    };

    result[itemKey] = valueMap[normalizedKey] || "";
    return result;
  }, {});
}

function getMatchStatsSelectionLimit(manifest) {
  const statisticsSection = getManifestConfiguredSections(manifest).find((section) => {
    if (!section.isList) {
      return false;
    }

    const normalizedItemKeys = section.itemKeys.map(normalizeManifestKey);
    return (
      normalizedItemKeys.some((itemKey) =>
        ["home_value", "away_value", "description", "stat_label", "match_stats"].includes(itemKey)
      ) || section.normalizedKey.includes("stat")
    );
  });

  return statisticsSection?.fieldRows?.length || 5;
}

function isMatchStatsScene4012Manifest(manifest) {
  return Number(manifest?.metadata?.scene) === 4012;
}

function getMatchStatsSectionItemKeys(section, fallbackKeys = []) {
  if (Array.isArray(section?.item) && section.item.length) {
    return section.item;
  }

  if (Array.isArray(section?.list_item) && section.list_item.length) {
    return section.list_item;
  }

  return fallbackKeys;
}

function buildCombinedMatchStatValue(selectedData, item, suffix) {
  const homeTeam = selectedData?.homeTeam?.team || {};
  const awayTeam = selectedData?.awayTeam?.team || {};

  return `${getTeamBadgeValue(homeTeam)} ${appendMatchStatSuffix(item.homeValue, suffix)} (${formatMatchStatsFieldLabel(
    item.label
  )}) ${appendMatchStatSuffix(item.awayValue, suffix)} ${getTeamBadgeValue(awayTeam)}`
    .replace(/\s+/g, " ")
    .trim();
}

function buildMatchScoreValue(selectedData) {
  return `${getTeamScoreValue(selectedData?.homeTeam)} - ${getTeamScoreValue(selectedData?.awayTeam)}`.trim();
}

function resolveMatchStatsSectionItemValue(itemKey, selectedData) {
  const homeTeam = selectedData?.homeTeam?.team || {};
  const awayTeam = selectedData?.awayTeam?.team || {};
  const homeCaptain = findTeamCaptainPlayer(selectedData?.homeTeam?.players);
  const awayCaptain = findTeamCaptainPlayer(selectedData?.awayTeam?.players);
  const normalizedKey = normalizeManifestKey(itemKey);
  const imageValue = buildImageManifestPayload(itemKey, {
    awayCaptainName: awayCaptain ? getPlayerDisplayName(awayCaptain) : "",
    awayTeamName: getTeamImageNameValue(awayTeam),
    homeCaptainName: homeCaptain ? getPlayerDisplayName(homeCaptain) : "",
    homeTeamName: getTeamImageNameValue(homeTeam),
  });

  if (imageValue) {
    return imageValue;
  }

  if (normalizedKey.includes("competition")) {
    return selectedData?.competition?.name || "";
  }

  if (normalizedKey.includes("season")) {
    return selectedData?.season?.name || "";
  }

  if (normalizedKey.includes("venue")) {
    return selectedData?.venue?.name || "";
  }

  if (normalizedKey.includes("period") || normalizedKey.includes("phase")) {
    return getPeriodLabelValue(selectedData);
  }

  if (normalizedKey === "title" || normalizedKey.includes("title")) {
    return "Match Stats";
  }

  if (normalizedKey.includes("page_state") || normalizedKey === "value") {
    return getPageStateValue(selectedData);
  }

  if (normalizedKey.includes("match_info")) {
    return `Match Stats: ${getTeamBadgeValue(homeTeam)} ${buildMatchScoreValue(selectedData)} ${getTeamBadgeValue(awayTeam)}`.trim();
  }

  if (normalizedKey.includes("home") && normalizedKey.includes("team") && normalizedKey.includes("name")) {
    return getTeamNameValue(homeTeam);
  }

  if (normalizedKey.includes("away") && normalizedKey.includes("team") && normalizedKey.includes("name")) {
    return getTeamNameValue(awayTeam);
  }

  if (normalizedKey.includes("score") && !normalizedKey.includes("home") && !normalizedKey.includes("away")) {
    return buildMatchScoreValue(selectedData);
  }

  if (normalizedKey.includes("home") && (normalizedKey.includes("score") || normalizedKey.includes("value"))) {
    return getTeamScoreValue(selectedData?.homeTeam);
  }

  if (normalizedKey.includes("away") && (normalizedKey.includes("score") || normalizedKey.includes("value"))) {
    return getTeamScoreValue(selectedData?.awayTeam);
  }

  if (normalizedKey.includes("home") && (normalizedKey.includes("badge") || normalizedKey.includes("abbr"))) {
    return getTeamBadgeValue(homeTeam);
  }

  if (normalizedKey.includes("away") && (normalizedKey.includes("badge") || normalizedKey.includes("abbr"))) {
    return getTeamBadgeValue(awayTeam);
  }

  return "";
}

function resolveMatchStatsStatisticValue(itemKey, selectedData, item, suffix) {
  const normalizedKey = normalizeManifestKey(itemKey);

  if (normalizedKey.includes("home") && normalizedKey.includes("suffix")) {
    return suffix || "";
  }

  if (normalizedKey.includes("away") && normalizedKey.includes("suffix")) {
    return suffix || "";
  }

  if (normalizedKey.includes("home") && normalizedKey.includes("value")) {
    return appendMatchStatSuffix(item.homeValue, suffix);
  }

  if (normalizedKey.includes("away") && normalizedKey.includes("value")) {
    return appendMatchStatSuffix(item.awayValue, suffix);
  }

  if (normalizedKey.includes("description") || normalizedKey.includes("label")) {
    return formatMatchStatsFieldLabel(item.label);
  }

  if (normalizedKey.includes("match_stats") || normalizedKey === "stat_value") {
    return buildCombinedMatchStatValue(selectedData, item, suffix);
  }

  return "";
}

function appendMatchStatSuffix(value, suffix) {
  if (!suffix) {
    return value;
  }

  if (value === null || value === undefined || value === "" || value === "-") {
    return value;
  }

  return `${value}${suffix}`;
}

function buildManifestLikeMatchStatsData(selectedData, selectedStatPaths, options = {}) {
  const manifest = options.manifest;
  const selectionLimit = getMatchStatsSelectionLimit(manifest);
  const suffixByPath = options.suffixByPath || {};
  const selectedItems = getMatchStatSelectableItems(selectedData, selectedStatPaths).slice(0, selectionLimit);
  const sections = getManifestConfiguredSections(manifest);

  return sections.reduce(
    (result, section) => {
      if (section.isList) {
        result[section.key] = {
          data: selectedItems.slice(0, section.fieldRows.length || selectedItems.length).map((item) => {
            const suffix = suffixByPath[item.path] ?? item.defaultSuffix;

            return section.itemKeys.reduce((row, itemKey) => {
              row[itemKey] = resolveMatchStatsStatisticValue(itemKey, selectedData, item, suffix);
              return row;
            }, {});
          }),
          list_item: section.itemKeys,
        };

        return result;
      }

      result[section.key] = {
        data: section.itemKeys.reduce((sectionData, itemKey) => {
          sectionData[itemKey] = resolveMatchStatsSectionItemValue(itemKey, selectedData);
          return sectionData;
        }, {}),
        item: section.itemKeys,
      };

      return result;
    },
    {
      competition: selectedData?.competition ?? null,
      season: selectedData?.season ?? null,
      venue: selectedData?.venue ?? null,
    }
  );
}

function isTeamSheetsPayload(selectedData) {
  return Boolean(
    Array.isArray(selectedData?.homeTeam?.players) ||
      Array.isArray(selectedData?.awayTeam?.players) ||
      Array.isArray(selectedData?.officials)
  );
}

function isTopPlayerScoresDataType(selectedDataType) {
  const combinedLabel = `${selectedDataType?.dataType || ""} ${selectedDataType?.type || ""}`.toLowerCase();
  return combinedLabel.includes("top 10") || combinedLabel.includes("top10");
}

function isHeadToHeadPayload(selectedData) {
  return Boolean(selectedData?.headToHeadStats && selectedData?.teams?.homeTeam && selectedData?.teams?.awayTeam);
}

function isHeadToHeadTeamComparison(value) {
  return isRecord(value) && (Object.prototype.hasOwnProperty.call(value, "homeTeam") || Object.prototype.hasOwnProperty.call(value, "awayTeam"));
}

function collectHeadToHeadSummaryPaths(source, parentPath = "", paths = []) {
  if (!isRecord(source)) {
    return paths;
  }

  Object.entries(source).forEach(([key, value]) => {
    const nextPath = parentPath ? `${parentPath}.${key}` : key;

    if (Array.isArray(value)) {
      return;
    }

    if (isHeadToHeadTeamComparison(value)) {
      if (Object.prototype.hasOwnProperty.call(value, "homeTeam")) {
        paths.push(`${nextPath}.homeTeam`);
      }

      if (Object.prototype.hasOwnProperty.call(value, "awayTeam")) {
        paths.push(`${nextPath}.awayTeam`);
      }

      return;
    }

    if (isRecord(value)) {
      collectHeadToHeadSummaryPaths(value, nextPath, paths);
      return;
    }

    paths.push(nextPath);
  });

  return paths;
}

function buildHeadToHeadSummaryItems(selectedData) {
  const headToHeadStats = selectedData?.headToHeadStats || {};

  return collectHeadToHeadSummaryPaths(headToHeadStats).map((path) => ({
    id: `summary:${path}`,
    path,
    label: formatHeadToHeadSummaryLabel(path, selectedData),
    value: formatListItemValue(getNestedValue(headToHeadStats, path)),
  }));
}

function buildHeadToHeadMatchItems(selectedData) {
  return (selectedData?.headToHeadStats?.last5Matches || []).map((match, index) => ({
    id: `last5Matches:${String(match?.matchId ?? index + 1)}`,
    path: "last5Matches",
    matchId: match?.matchId ?? `match-${index + 1}`,
    compName: match?.compName || selectedData?.matchInfo?.competition?.seasonName || "Competition",
    matchDate: match?.matchDate || "-",
    venue: match?.venue || selectedData?.matchInfo?.venue?.name || "-",
    winner: match?.winner || "-",
    homeTeamScore: formatListItemValue(match?.homeTeamScore),
    awayTeamScore: formatListItemValue(match?.awayTeamScore),
    raw: match,
  }));
}

function buildHeadToHeadFormItems(selectedData) {
  const homeTeamName = selectedData?.teams?.homeTeam?.name || "Home Team";
  const awayTeamName = selectedData?.teams?.awayTeam?.name || "Away Team";

  return [
    ["homeTeam", homeTeamName, selectedData?.headToHeadStats?.form?.homeTeam || []],
    ["awayTeam", awayTeamName, selectedData?.headToHeadStats?.form?.awayTeam || []],
  ].flatMap(([teamKey, teamLabel, items]) =>
    items.map((entry, index) => ({
      id: `form.${teamKey}:${String(entry?.matchId ?? index + 1)}`,
      teamKey,
      teamLabel,
      result: entry?.result || "-",
      oppositionTeamName: entry?.oppositionTeamName || "Opponent",
      matchDate: entry?.matchDate || "-",
      matchId: entry?.matchId ?? `form-${teamKey}-${index + 1}`,
      raw: entry,
    }))
  );
}

function buildFilteredHeadToHeadData(selectedData, selectedFieldPaths, options = {}) {
  const selectedPathSet = new Set(selectedFieldPaths);
  const headToHeadStats = selectedData?.headToHeadStats || {};
  const filteredHeadToHeadStats = {};

  (options.summaryItems || []).forEach((item) => {
    if (!selectedPathSet.has(item.id)) {
      return;
    }

    setNestedValue(filteredHeadToHeadStats, item.path, getNestedValue(headToHeadStats, item.path));
  });

  const selectedMatches = (options.matchItems || [])
    .filter((item) => selectedPathSet.has(item.id))
    .map((item) => item.raw);

  if (selectedMatches.length) {
    filteredHeadToHeadStats.last5Matches = selectedMatches;
  }

  const selectedHomeForm = (options.formItems || [])
    .filter((item) => item.teamKey === "homeTeam" && selectedPathSet.has(item.id))
    .map((item) => item.raw);

  const selectedAwayForm = (options.formItems || [])
    .filter((item) => item.teamKey === "awayTeam" && selectedPathSet.has(item.id))
    .map((item) => item.raw);

  if (selectedHomeForm.length || selectedAwayForm.length) {
    filteredHeadToHeadStats.form = {};

    if (selectedHomeForm.length) {
      filteredHeadToHeadStats.form.homeTeam = selectedHomeForm;
    }

    if (selectedAwayForm.length) {
      filteredHeadToHeadStats.form.awayTeam = selectedAwayForm;
    }
  }

  return {
    matchId: selectedData?.matchId ?? null,
    matchInfo: selectedData?.matchInfo ?? null,
    teams: selectedData?.teams ?? null,
    headToHeadStats: filteredHeadToHeadStats,
  };
}

function getTopPlayerName(entry) {
  return (
    entry?.player?.knownName ||
    entry?.player?.name ||
    entry?.knownName ||
    entry?.playerName ||
    entry?.name ||
    [entry?.firstName, entry?.lastName].filter(Boolean).join(" ") ||
    null
  );
}

function getTopPlayerRank(entry, index) {
  return entry?.rank ?? entry?.position ?? entry?.place ?? entry?.order ?? index + 1;
}

function getTopPlayerStatScore(entry) {
  return (
    entry?.statScore ??
    entry?.score ??
    entry?.value ??
    entry?.points ??
    entry?.total ??
    entry?.scored ??
    entry?.stat?.value ??
    entry?.metricValue ??
    null
  );
}

function getTopPlayerStatLabel(entry, fallbackLabel = "Stat Scored") {
  return (
    entry?.statLabel ||
    entry?.stat?.name ||
    entry?.metric ||
    entry?.metricName ||
    entry?.description ||
    fallbackLabel
  );
}

function looksLikeTopPlayerEntry(entry) {
  if (!isRecord(entry)) {
    return false;
  }

  return Boolean(getTopPlayerName(entry) && getTopPlayerStatScore(entry) !== null);
}

function getTopPlayerCandidateEntries(selectedData) {
  return collectTopPlayerLists(selectedData).flatMap((list) => list.entries);
}

function formatTopPlayerSectionLabel(path, selectedDataType) {
  const segments = path.split(".").filter(Boolean);
  const filteredSegments = segments[0] === "stats" ? segments.slice(1) : segments;

  if (!filteredSegments.length) {
    return humanizeLabel(selectedDataType?.type || selectedDataType?.dataType || "Top Players");
  }

  return filteredSegments.map((segment) => humanizeLabel(segment)).join(" | ");
}

function collectTopPlayerLists(source, parentPath = "") {
  if (Array.isArray(source)) {
    return source.some(looksLikeTopPlayerEntry) ? [{ path: parentPath, entries: source }] : [];
  }

  if (!isRecord(source)) {
    return [];
  }

  return Object.entries(source).flatMap(([key, value]) => {
    const nextPath = parentPath ? `${parentPath}.${key}` : key;
    return collectTopPlayerLists(value, nextPath);
  });
}

function buildTopPlayerSelectableItems(selectedData, selectedDataType) {
  const fallbackLabel = humanizeLabel(selectedDataType?.type || selectedDataType?.dataType || "Stat scored");

  return collectTopPlayerLists(selectedData).flatMap((list) =>
    list.entries.filter(looksLikeTopPlayerEntry).map((entry, index) => ({
      id: `${list.path}:${String(entry?.id ?? entry?.playerId ?? entry?.player?.id ?? `top-player-${index + 1}`)}`,
      sectionPath: list.path,
      sectionLabel: formatTopPlayerSectionLabel(list.path, selectedDataType),
      rank: formatListItemValue(getTopPlayerRank(entry, index)),
      playerName: getTopPlayerName(entry) || "Player",
      statScore: formatListItemValue(getTopPlayerStatScore(entry)),
      statLabel: humanizeLabel(getTopPlayerStatLabel(entry, fallbackLabel)),
      raw: entry,
    }))
  );
}

function buildFilteredTopPlayerScoresData(selectedData, selectedItemIds, topPlayerItems) {
  const selectedIdSet = new Set(selectedItemIds);
  const filteredStats = {};

  topPlayerItems
    .filter((item) => selectedIdSet.has(item.id))
    .forEach((item) => {
      const currentList = getNestedValue(filteredStats, item.sectionPath) || [];
      currentList.push({
        rank: item.rank,
        playerName: item.playerName,
        statScore: item.statScore,
        statLabel: item.statLabel,
      });
      setNestedValue(filteredStats, item.sectionPath, currentList);
    });

  return {
    compId: selectedData?.compId ?? selectedData?.competition?.id ?? null,
    compName: selectedData?.compName ?? selectedData?.competition?.name ?? null,
    seasonId: selectedData?.seasonId ?? selectedData?.season?.id ?? null,
    seasonName: selectedData?.seasonName ?? selectedData?.season?.name ?? null,
    stats: filteredStats.stats || filteredStats,
  };
}

function getTeamSheetSelectionId(scope, teamKey, entity, index) {
  const entityId = entity?.id ?? `${scope}-${index + 1}`;
  return teamKey ? `${teamKey}.${scope}.${entityId}` : `${scope}.${entityId}`;
}

function getPersonDisplayName(person, fallback = "Person") {
  return (
    person?.knownName ||
    person?.name ||
    [person?.firstName, person?.lastName || person?.surname].filter(Boolean).join(" ") ||
    fallback
  );
}

function getPlayerDisplayName(player) {
  return getPersonDisplayName(player, "Player");
}

function normalizeComparisonValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getImageResolutionFailureName(message) {
  const normalizedMessage = String(message || "");
  const directMatch = normalizedMessage.match(/Unable to resolve (?:player|team) image for ['"]([^'"]+)['"]/i);

  if (directMatch?.[1]) {
    return directMatch[1].trim();
  }

  const fallbackMatch = normalizedMessage.match(/Unable to resolve .*?image.*?['"]([^'"]+)['"]/i);
  return fallbackMatch?.[1]?.trim() || "";
}

function getTeamSheetPlayerIdsByName(teamOption, playerName) {
  if (!teamOption || !playerName) {
    return [];
  }

  const normalizedPlayerName = normalizeComparisonValue(playerName);

  return teamOption.players
    .filter((player) => {
      const nameParts = getPersonNameParts(player.raw, "Player");
      const candidateNames = [
        player.primary,
        getPlayerDisplayName(player.raw),
        nameParts.displayName,
        nameParts.name,
        nameParts.surname,
        [nameParts.name, nameParts.surname].filter(Boolean).join(" "),
        player.raw?.knownName,
        player.raw?.name,
      ];

      return candidateNames.some((candidateName) => normalizeComparisonValue(candidateName) === normalizedPlayerName);
    })
    .map((player) => player.id);
}

function getPersonNameParts(person, fallback = "Person") {
  const displayName = getPersonDisplayName(person, fallback).trim();
  const nameParts = displayName.split(/\s+/).filter(Boolean);

  return {
    displayName,
    name: person?.firstName || nameParts[0] || "",
    surname:
      person?.lastName || person?.surname || person?.familyName || nameParts.slice(1).join(" ") || "",
  };
}

function getTeamLabel(teamData, fallback) {
  return teamData?.team?.shortName || teamData?.team?.name || fallback;
}

function getPlayerShirtNumber(player) {
  return player?.position?.shirtNumber ?? null;
}

function isSubstitutePlayer(player) {
  const shirtNumber = Number(getPlayerShirtNumber(player));
  return Number.isFinite(shirtNumber) && shirtNumber >= 16;
}

function sortPlayersByShirtNumber(players) {
  return [...players].sort((left, right) => {
    const leftNumber = Number(getPlayerShirtNumber(left));
    const rightNumber = Number(getPlayerShirtNumber(right));

    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }

    return getPlayerDisplayName(left).localeCompare(getPlayerDisplayName(right));
  });
}

function getTeamSheetSectionConfig(config, fallbackItemKeys = []) {
  if (!isRecord(config)) {
    return {
      fields: [],
      key: "",
      itemKeys: fallbackItemKeys,
    };
  }

  return {
    fields: Array.isArray(config.list) ? config.list : Array.isArray(config.fields) ? config.fields : [],
    key: "",
    itemKeys:
      Array.isArray(config.list_item)
        ? config.list_item
        : Array.isArray(config.item)
          ? config.item
          : typeof config.item === "string" && config.item.trim()
            ? [config.item.trim()]
            : fallbackItemKeys,
  };
}

function getTeamSheetManifestSections(manifest) {
  const manifestConfig = isRecord(manifest) ? manifest : {};
  const manifestSections = getManifestConfiguredSections(manifestConfig);
  const findSection = (predicate, fallbackConfig = null, fallbackItemKeys = []) => {
    const section = manifestSections.find(predicate);

    if (section) {
      return {
        fields: section.fieldRows,
        itemKeys: section.itemKeys,
        key: section.key,
      };
    }

    if (isRecord(fallbackConfig)) {
      return getTeamSheetSectionConfig(fallbackConfig, fallbackItemKeys);
    }

    return {
      fields: [],
      key: "",
      itemKeys: [],
    };
  };

  const isCoachSection = (section) => {
    const itemKeys = section.itemKeys.map(normalizeManifestKey);
    return !section.isList && (section.normalizedKey.includes("coach") || itemKeys.some((itemKey) => itemKey.includes("coach")));
  };

  const isHeadCoachSection = (section) => {
    const itemKeys = section.itemKeys.map(normalizeManifestKey);
    return isCoachSection(section) && (section.normalizedKey.includes("head") || itemKeys.some((itemKey) => itemKey.includes("head")));
  };

  const isPlayerSection = (section) => {
    const itemKeys = section.itemKeys.map(normalizeManifestKey);
    return (
      section.isList &&
      itemKeys.some((itemKey) => itemKey.includes("player") || itemKey.includes("jersey") || itemKey === "name" || itemKey === "surname")
    );
  };

  const isSubstituteSection = (section) => isPlayerSection(section) && /(sub|replacement|bench)/.test(section.normalizedKey);
  const isHeaderSection = (section) => {
    const itemKeys = section.itemKeys.map(normalizeManifestKey);
    return (
      !section.isList &&
      (section.normalizedKey === "header" ||
        itemKeys.some((itemKey) => itemKey.includes("team_name") || itemKey.includes("team_logo")))
    );
  };

  return {
    allSections: manifestSections,
    coach: findSection((section) => isCoachSection(section) && !isHeadCoachSection(section), manifestConfig.coach, ["name", "surname"]),
    headCoach: findSection(isHeadCoachSection, manifestConfig.head_coach, ["name", "surname"]),
    homeTeamReplacements: getTeamSheetSectionConfig(
      manifestConfig.home_team_replacements,
      ["jersey_number", "name", "surname"]
    ),
    awayTeamReplacements: getTeamSheetSectionConfig(
      manifestConfig.away_team_replacements,
      ["jersey_number", "name", "surname"]
    ),
    matchHeader: findSection((section) => section.normalizedKey === "match_header", manifestConfig.match_header, [
      "#img:home_team_logo",
      "home_team_name",
      "#img:away_team_logo",
      "away_team_name",
    ]),
    playersList: findSection(
      (section) => isPlayerSection(section) && !isSubstituteSection(section),
      manifestConfig.players_list,
      ["jersey_number", "name", "surname"]
    ),
    substitutes: findSection((section) => isSubstituteSection(section), null, []),
    teamHeader: findSection(isHeaderSection, manifestConfig.header, ["team_name", "#img:team_logo"]),
    teamLogo: findSection(
      (section) => !section.isList && section.itemKeys.map(normalizeManifestKey).some((itemKey) => itemKey.includes("team_logo")),
      manifestConfig.team_logo,
      ["#img:team_logo"]
    ),
    teamName: findSection(
      (section) => !section.isList && section.itemKeys.map(normalizeManifestKey).some((itemKey) => itemKey.includes("team_name") || itemKey === "name"),
      manifestConfig.team_name,
      ["name"]
    ),
  };
}

function isTeamSheetReplacementsManifest(manifestSections) {
  return Boolean(
    manifestSections?.homeTeamReplacements?.fields?.length || manifestSections?.awayTeamReplacements?.fields?.length
  );
}

function buildTeamNameOptions(teamData, fallbackLabel) {
  const values = Array.from(
    new Set(
      [teamData?.team?.name, teamData?.team?.shortName, teamData?.team?.abbreviation, teamData?.team?.code]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    )
  );

  return (values.length ? values : [fallbackLabel]).map((value) => ({
    label: value,
    value,
  }));
}

function buildTeamSheetTeamOptions(selectedData) {
  return [
    ["homeTeam", selectedData?.homeTeam, "Home"],
    ["awayTeam", selectedData?.awayTeam, "Away"],
  ].flatMap(([teamKey, teamData, fallbackLabel]) => {
    if (!teamData) {
      return [];
    }

    const label = getTeamLabel(teamData, fallbackLabel);
    const players = sortPlayersByShirtNumber(teamData?.players || []).map((player, index) => {
      const shirtNumber = getPlayerShirtNumber(player);
      const positionName = player?.position?.name ? humanizeLabel(player.position.name) : null;
      const tags = [player?.captain === "true" ? "Captain" : null, positionName].filter(Boolean);

      return {
        badge: shirtNumber !== null && shirtNumber !== undefined ? String(shirtNumber) : "-",
        id: getTeamSheetSelectionId("players", teamKey, player, index),
        primary: getPlayerDisplayName(player),
        raw: player,
        secondary: tags.join(" | "),
      };
    });

    const coaches = (teamData?.coaches || []).map((coach, index) => ({
      badge: "C",
      id: getTeamSheetSelectionId("coaches", teamKey, coach, index),
      primary: getPersonDisplayName(coach, "Coach"),
      raw: coach,
      secondary: coach?.role?.name ? humanizeLabel(coach.role.name) : "Coach",
    }));

    return [
      {
        coaches,
        label,
        players,
        teamData,
        teamKey,
        teamNameOptions: buildTeamNameOptions(teamData, label),
      },
    ];
  });
}

function isHeadCoach(entity) {
  const roleLabel = entity?.role?.name || entity?.role || "";
  return String(roleLabel).toLowerCase().includes("head");
}

function getDefaultTeamSheetCoachSelections(teamOption) {
  const headCoach = teamOption?.coaches.find((coach) => isHeadCoach(coach.raw)) || teamOption?.coaches[0] || null;
  const coach = teamOption?.coaches.find((item) => item.id !== headCoach?.id) || headCoach || null;

  return {
    coachId: coach?.id || "",
    headCoachId: headCoach?.id || coach?.id || "",
  };
}

function getTeamSheetPresetFields(selectedDataType) {
  const presetCandidates = [
    selectedDataType?.teamSheetFields,
    selectedDataType?.team_sheet_fields,
    selectedDataType?.teamSheetData,
    selectedDataType?.fields,
  ];

  return (
    presetCandidates.find(
      (candidate) =>
        isRecord(candidate) &&
        (candidate.players_list || candidate.players || candidate.head_coach || candidate.coach || candidate.team_name)
    ) || null
  );
}

function findTeamSheetTeamOption(teamOptions, reference) {
  if (!reference) {
    return null;
  }

  const normalizedReference = String(reference).trim().toLowerCase();

  return (
    teamOptions.find((teamOption) => {
      const candidateValues = [
        teamOption.teamKey,
        teamOption.label,
        teamOption.teamData?.team?.name,
        teamOption.teamData?.team?.shortName,
      ]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase());

      return candidateValues.includes(normalizedReference);
    }) || null
  );
}

function findTeamSheetOptionByReference(items, reference) {
  if (!reference) {
    return null;
  }

  const referenceValue = isRecord(reference)
    ? reference.id || reference.selectionId || reference.name || reference.knownName || reference.jersey_number || reference.shirtNumber
    : reference;

  const normalizedReference = String(referenceValue ?? "").trim().toLowerCase();
  if (!normalizedReference) {
    return null;
  }

  return (
    items.find((item) => {
      const candidateValues = [
        item.id,
        item.primary,
        item.badge,
        item.raw?.id,
        item.raw?.name,
        item.raw?.knownName,
        item.raw?.position?.shirtNumber,
      ]
        .filter((value) => value !== null && value !== undefined && value !== "")
        .map((value) => String(value).trim().toLowerCase());

      return candidateValues.includes(normalizedReference);
    }) || null
  );
}

function resolveTeamSheetPresetSelection(teamOptions, preset, playerLimit) {
  if (!preset || !teamOptions.length) {
    return null;
  }

  const teamOption =
    findTeamSheetTeamOption(teamOptions, preset.teamKey || preset.team || preset.side || preset.team_name?.name) ||
    teamOptions[0];

  if (!teamOption) {
    return null;
  }

  const presetPlayers = [
    preset.players_list?.data,
    preset.body_starting_lineup?.data,
    preset.starting_lineup?.data,
    preset.players_list,
    preset.starting_lineup,
    preset.players,
  ].find((candidate) => Array.isArray(candidate)) || [];

  const coachReference = preset.coach?.data || preset.coach || preset.body_coach?.data || preset.body_coach;
  const headCoachReference =
    preset.head_coach?.data || preset.head_coach || preset.body_head_coach?.data || preset.body_head_coach;
  const teamNameReference =
    preset.team_name?.data?.name ||
    preset.team_name?.name ||
    preset.team_name ||
    preset.header?.data?.team_name ||
    teamOption.teamNameOptions[0]?.value ||
    "";

  return {
    coachId: findTeamSheetOptionByReference(teamOption.coaches, coachReference)?.id || "",
    headCoachId: findTeamSheetOptionByReference(teamOption.coaches, headCoachReference)?.id || "",
    playerIds: presetPlayers
      .map((player) => findTeamSheetOptionByReference(teamOption.players, player)?.id || "")
      .filter(Boolean)
      .slice(0, playerLimit),
    teamKey: teamOption.teamKey,
    teamName: teamNameReference,
  };
}

function getTeamSheetValueByKey(source, key, type, teamName = "", options = {}) {
  const displayName =
    type === "player"
      ? getPlayerDisplayName(source)
      : type === "coach"
        ? getPersonDisplayName(source, "Coach")
        : "";
  const imagePayload = buildImageManifestPayload(key, {
    awayTeamName: options.awayTeamName,
    homeTeamName: options.homeTeamName,
    playerName: displayName,
    teamName: options.teamImageName || teamName,
  });

  if (imagePayload) {
    return imagePayload;
  }

  const normalizedKey = String(key || "").trim().toLowerCase();
  const canonicalKey = normalizedKey
    .replace(/^head_coach_/, "")
    .replace(/^coach_/, "")
    .replace(/^player_/, "")
    .replace(/^team_/, "");

  if (["image", "player_image", "playerimage", "coach_photo", "player_photo"].includes(canonicalKey)) {
    return buildImageManifestPayload("#img:team:player", {
      awayTeamName: options.awayTeamName,
      homeTeamName: options.homeTeamName,
      playerName: displayName,
      teamName: options.teamImageName || teamName,
    });
  }

  if (type === "team") {
    if (canonicalKey === "name") {
      return teamName;
    }

    if (canonicalKey.includes("short")) {
      return source?.shortName || teamName;
    }

    return source?.[canonicalKey] ?? source?.[key] ?? teamName;
  }

  const nameParts = getPersonNameParts(source, type === "player" ? "Player" : "Coach");

  if (["jersey_number", "shirt_number", "shirtnumber"].includes(canonicalKey)) {
    return getPlayerShirtNumber(source) ?? "";
  }

  if (["name", "first_name", "firstname", "given_name", "givenname"].includes(canonicalKey)) {
    return nameParts.name;
  }

  if (["surname", "last_name", "lastname", "family_name", "familyname"].includes(canonicalKey)) {
    return nameParts.surname;
  }

  if (["known_name", "knownname", "full_name", "fullname", "display_name", "displayname"].includes(canonicalKey)) {
    return nameParts.displayName;
  }

  return source?.[canonicalKey] ?? source?.[key] ?? source?.value ?? "";
}

function resolveTeamSheetManifestValue(itemKey, source, type, selectedData, teamName, options = {}) {
  const normalizedKey = normalizeManifestKey(itemKey);

  if (normalizedKey.includes("competition")) {
    return selectedData?.competition?.name || "";
  }

  if (normalizedKey.includes("season")) {
    return selectedData?.season?.name || "";
  }

  if (normalizedKey.includes("venue")) {
    return selectedData?.venue?.name || "";
  }

  return getTeamSheetValueByKey(source, itemKey, type, teamName, options);
}

function buildTeamSheetManifestRows(players, itemKeys, rowCount, selectedData, teamName, teamImageName) {
  return Array.from({ length: rowCount }, (_, index) => {
    const player = players[index] || null;

    return itemKeys.reduce((result, itemKey) => {
      result[itemKey] = player
        ? resolveTeamSheetManifestValue(itemKey, player, "player", selectedData, teamName, {
            awayTeamName: getTeamNameValue(selectedData?.awayTeam?.team || {}),
            homeTeamName: getTeamNameValue(selectedData?.homeTeam?.team || {}),
            teamImageName,
          })
        : "";
      return result;
    }, {});
  });
}

function buildTeamSheetReplacementRows(teamData, itemKeys, rowCount, selectedData) {
  const resolvedItemKeys = Array.isArray(itemKeys) && itemKeys.length ? itemKeys : ["jersey_number", "name", "surname"];
  const team = teamData?.team || {};
  const resolvedTeamName = getTeamNameValue(team);
  const resolvedTeamImageName = getTeamImageNameValue(team) || resolvedTeamName;
  const homeTeamName = getTeamNameValue(selectedData?.homeTeam?.team || {});
  const awayTeamName = getTeamNameValue(selectedData?.awayTeam?.team || {});
  const replacements = sortPlayersByShirtNumber((teamData?.players || []).filter((player) => isSubstitutePlayer(player)));

  return Array.from({ length: rowCount }, (_, index) => {
    const player = replacements[index] || null;

    return resolvedItemKeys.reduce((result, itemKey) => {
      result[itemKey] = player
        ? getTeamSheetValueByKey(player, itemKey, "player", resolvedTeamName, {
            awayTeamName,
            homeTeamName,
            teamImageName: resolvedTeamImageName,
          })
        : "";
      return result;
    }, {});
  });
}

function buildTeamSheetMatchHeaderData(selectedData, itemKeys) {
  const resolvedItemKeys = Array.isArray(itemKeys) && itemKeys.length
    ? itemKeys
    : ["#img:home_team_logo", "home_team_name", "#img:away_team_logo", "away_team_name"];
  const homeTeam = selectedData?.homeTeam?.team || {};
  const awayTeam = selectedData?.awayTeam?.team || {};

  return resolvedItemKeys.reduce((result, itemKey) => {
    const valueMap = {
      away_team_name: getTeamNameValue(awayTeam),
      home_team_name: getTeamNameValue(homeTeam),
    };

    result[itemKey] =
      valueMap[itemKey] ??
      buildImageManifestPayload(itemKey, {
        awayTeamName: getTeamImageNameValue(awayTeam),
        homeTeamName: getTeamImageNameValue(homeTeam),
      }) ??
      "";
    return result;
  }, {});
}

function buildManifestLikeTeamSheetData(selectedData, selection, manifestSections) {
  if (isTeamSheetReplacementsManifest(manifestSections)) {
    const matchHeaderItemKeys = manifestSections?.matchHeader?.itemKeys || [
      "#img:home_team_logo",
      "home_team_name",
      "#img:away_team_logo",
      "away_team_name",
    ];
    const homeReplacementItemKeys = manifestSections?.homeTeamReplacements?.itemKeys || [
      "jersey_number",
      "name",
      "surname",
    ];
    const awayReplacementItemKeys = manifestSections?.awayTeamReplacements?.itemKeys || [
      "jersey_number",
      "name",
      "surname",
    ];
    const homeReplacementRowCount = manifestSections?.homeTeamReplacements?.fields?.length || 0;
    const awayReplacementRowCount = manifestSections?.awayTeamReplacements?.fields?.length || 0;

    return {
      competition: selectedData?.competition ?? null,
      season: selectedData?.season ?? null,
      venue: selectedData?.venue ?? null,
      match_header: {
        data: buildTeamSheetMatchHeaderData(selectedData, matchHeaderItemKeys),
        item: matchHeaderItemKeys,
      },
      home_team_replacements: {
        data: buildTeamSheetReplacementRows(
          selectedData?.homeTeam,
          homeReplacementItemKeys,
          homeReplacementRowCount,
          selectedData
        ),
        list_item: homeReplacementItemKeys,
      },
      away_team_replacements: {
        data: buildTeamSheetReplacementRows(
          selectedData?.awayTeam,
          awayReplacementItemKeys,
          awayReplacementRowCount,
          selectedData
        ),
        list_item: awayReplacementItemKeys,
      },
    };
  }

  const teamOption = selection?.teamOption;
  if (!teamOption) {
    return null;
  }

  const playersById = new Map(teamOption.players.map((player) => [player.id, player.raw]));
  const coachesById = new Map(teamOption.coaches.map((coach) => [coach.id, coach.raw]));
  const resolvedTeamName = selection.teamName || teamOption.teamNameOptions[0]?.value || teamOption.label;
  const resolvedTeamImageName = getTeamImageNameValue(teamOption.teamData?.team || {}) || resolvedTeamName;
  const homeTeamName = getTeamNameValue(selectedData?.homeTeam?.team || {});
  const awayTeamName = getTeamNameValue(selectedData?.awayTeam?.team || {});
  const selectedPlayers = selection.playerIds.map((playerId) => playersById.get(playerId)).filter(Boolean);
  const selectedPlayerIdSet = new Set(selection.playerIds);
  const remainingPlayers = teamOption.players
    .filter((player) => !selectedPlayerIdSet.has(player.id))
    .map((player) => player.raw);
  const substitutePlayers = sortPlayersByShirtNumber(
    remainingPlayers.some((player) => isSubstitutePlayer(player))
      ? remainingPlayers.filter((player) => isSubstitutePlayer(player))
      : remainingPlayers
  );
  const coach = coachesById.get(selection.coachId) || null;
  const headCoach = coachesById.get(selection.headCoachId) || coachesById.get(selection.coachId) || null;
  const allSections = Array.isArray(manifestSections?.allSections) ? manifestSections.allSections : [];

  if (allSections.length) {
    return allSections.reduce(
      (result, section) => {
        const itemKeys = section.itemKeys;

        if (section.isList) {
          const rowCount = section.fieldRows.length || selectedPlayers.length;
          result[section.key] = {
            data: /(sub|replacement|bench)/.test(section.normalizedKey)
              ? buildTeamSheetManifestRows(
                  substitutePlayers,
                  itemKeys,
                  rowCount,
                  selectedData,
                  resolvedTeamName,
                  resolvedTeamImageName
                )
              : buildTeamSheetManifestRows(
                  selectedPlayers,
                  itemKeys,
                  rowCount,
                  selectedData,
                  resolvedTeamName,
                  resolvedTeamImageName
                ),
            list_item: itemKeys,
          };
          return result;
        }

        const usesHeadCoach = section.normalizedKey.includes("head") && section.normalizedKey.includes("coach");
        const usesCoach = !usesHeadCoach && section.normalizedKey.includes("coach");
        const sectionSource = usesHeadCoach ? headCoach : usesCoach ? coach : teamOption.teamData?.team || {};
        const sectionType = usesHeadCoach || usesCoach ? "coach" : "team";

        result[section.key] = {
          data: itemKeys.reduce((sectionData, itemKey) => {
            sectionData[itemKey] = sectionSource
              ? resolveTeamSheetManifestValue(itemKey, sectionSource, sectionType, selectedData, resolvedTeamName, {
                  awayTeamName,
                  homeTeamName,
                  teamImageName: resolvedTeamImageName,
                })
              : "";
            return sectionData;
          }, {}),
          item: itemKeys,
        };

        return result;
      },
      {
        competition: selectedData?.competition ?? null,
        season: selectedData?.season ?? null,
        venue: selectedData?.venue ?? null,
      }
    );
  }

  return {
    competition: selectedData?.competition ?? null,
    season: selectedData?.season ?? null,
    venue: selectedData?.venue ?? null,
    coach: {
      data: (manifestSections?.coach?.itemKeys || ["name", "surname"]).reduce((result, itemKey) => {
        result[itemKey] = coach
          ? getTeamSheetValueByKey(coach, itemKey, "coach", resolvedTeamName, {
              awayTeamName,
              homeTeamName,
              teamImageName: resolvedTeamImageName,
            })
          : "";
        return result;
      }, {}),
      item: manifestSections?.coach?.itemKeys || ["name", "surname"],
    },
    head_coach: {
      data: (manifestSections?.headCoach?.itemKeys || ["name", "surname"]).reduce((result, itemKey) => {
        result[itemKey] = headCoach
          ? getTeamSheetValueByKey(headCoach, itemKey, "coach", resolvedTeamName, {
              awayTeamName,
              homeTeamName,
              teamImageName: resolvedTeamImageName,
            })
          : "";
        return result;
      }, {}),
      item: manifestSections?.headCoach?.itemKeys || ["name", "surname"],
    },
    players_list: {
      data: selectedPlayers.map((player) =>
          (manifestSections?.playersList?.itemKeys || ["jersey_number", "name", "surname"]).reduce((result, itemKey) => {
            result[itemKey] = getTeamSheetValueByKey(player, itemKey, "player", resolvedTeamName, {
              awayTeamName,
              homeTeamName,
              teamImageName: resolvedTeamImageName,
            });
            return result;
          }, {})
        ),
      list_item: manifestSections?.playersList?.itemKeys || ["jersey_number", "name", "surname"],
    },
    team_logo: {
      data: (manifestSections?.teamLogo?.itemKeys || ["#img:team_logo"]).reduce((result, itemKey) => {
        result[itemKey] = getTeamSheetValueByKey(teamOption.teamData?.team || {}, itemKey, "team", resolvedTeamName, {
          awayTeamName,
          homeTeamName,
          teamImageName: resolvedTeamImageName,
        });
        return result;
      }, {}),
      item: manifestSections?.teamLogo?.itemKeys || ["#img:team_logo"],
    },
    team_name: {
      data: (manifestSections?.teamName?.itemKeys || ["name"]).reduce((result, itemKey) => {
        result[itemKey] = getTeamSheetValueByKey(teamOption.teamData?.team || {}, itemKey, "team", resolvedTeamName, {
          awayTeamName,
          homeTeamName,
          teamImageName: resolvedTeamImageName,
        });
        return result;
      }, {}),
      item: manifestSections?.teamName?.itemKeys || ["name"],
    },
  };
}

const STANDINGS_COLUMN_HEADER_LABELS = {
  bonus: "BP",
  difference: "Diff",
  drawn: "D",
  lost: "L",
  played: "PLD",
  points: "PTS",
  won: "W",
};

function isStandingsManifest(manifest) {
  return Boolean(isRecord(manifest) && isRecord(manifest.standings_list));
}

function getValueByAliases(source, aliases = []) {
  for (const alias of aliases) {
    const value = getNestedValue(source, alias);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return "";
}

function getStandingsRows(group) {
  const rowCandidates = [
    group?.standings,
    group?.standingsList,
    group?.rows,
    group?.items,
    group?.entries,
    group?.teams,
    group?.table?.rows,
    group?.pool?.standings,
  ];

  return rowCandidates.find((candidate) => Array.isArray(candidate) && candidate.some((entry) => isRecord(entry))) || [];
}

function isFlatStandingsRow(entry) {
  return Boolean(
    isRecord(entry) &&
      (isRecord(entry.team) || entry.team_name || entry.teamName) &&
      (entry.position !== undefined || entry.points !== undefined || entry.played !== undefined)
  );
}

function getStandingsTeamId(entry) {
  return normalizeStandingsValue(
    getValueByAliases(entry, ["team.id", "teamId", "team_id", "id"])
  );
}

function getStandingsPools(selectedData) {
  const groups = Array.isArray(selectedData?.groups) ? selectedData.groups : [];

  if (!groups.length) {
    return [];
  }

  if (groups.every(isFlatStandingsRow)) {
    const poolMap = new Map();

    groups.forEach((entry, index) => {
      const poolName = getPoolName(entry, index);

      if (!poolMap.has(poolName)) {
        poolMap.set(poolName, {
          poolName,
          source: entry,
          rows: [],
        });
      }

      const pool = poolMap.get(poolName);
      const teamId = getStandingsTeamId(entry);

      if (!teamId || !pool.rows.some((row) => getStandingsTeamId(row) === teamId)) {
        pool.rows.push(entry);
      }
    });

    return Array.from(poolMap.values()).map((pool) => ({
      ...pool,
      rows: pool.rows
        .slice()
        .sort(
          (left, right) =>
            Number(getValueByAliases(left, ["position", "rank", "pos"]) || Number.MAX_SAFE_INTEGER) -
            Number(getValueByAliases(right, ["position", "rank", "pos"]) || Number.MAX_SAFE_INTEGER)
        ),
    }));
  }

  return groups.map((group, index) => ({
    poolName: getPoolName(group, index),
    rows: getStandingsRows(group),
    source: group,
  }));
}

function normalizeStandingsValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function getPoolName(group, index) {
  return normalizeStandingsValue(
    getValueByAliases(group, ["pool_name", "poolName", "name", "title", "label", "groupName", "pool.name"]) ||
      `Pool ${index + 1}`
  );
}

function getPoolNumber(group, row, index) {
  const poolValue =
    getValueByAliases(row, ["pool_number", "poolNumber", "pool.number"]) ||
    getValueByAliases(group, ["pool_number", "poolNumber", "number", "pool.number", "pool.code"]);

  if (poolValue) {
    return normalizeStandingsValue(poolValue);
  }

  const poolName = getPoolName(group, index);
  const suffix = poolName.match(/([A-Z0-9]+)$/i)?.[1];
  return suffix || poolName;
}

function getManifestSectionItemKeys(section) {
  if (!isRecord(section)) {
    return [];
  }

  if (Array.isArray(section.list_item)) {
    return section.list_item;
  }

  if (Array.isArray(section.item)) {
    return section.item;
  }

  return [];
}

function getStandingsItemValue(itemKey, row) {
  if (typeof itemKey === "string" && itemKey.startsWith("#img:")) {
    const teamImageName = getValueByAliases(row, ["team.name", "team_name", "teamName", "name"]);
    return buildImageManifestPayload(itemKey, {
      teamName: normalizeStandingsValue(teamImageName),
    });
  }

  return row[itemKey] ?? "";
}

function buildManifestSectionData(section, preferredValue, fallbackAliases = [], source = null) {
  const itemKeys = getManifestSectionItemKeys(section);

  return {
    data: itemKeys.reduce((result, itemKey, index) => {
      if (source) {
        result[itemKey] = normalizeStandingsValue(getValueByAliases(source, [itemKey, ...fallbackAliases]));
        return result;
      }

      result[itemKey] = index === 0 ? normalizeStandingsValue(preferredValue) : "";
      return result;
    }, {}),
    item: itemKeys,
  };
}

function buildStandingsColumnHeaders(manifest) {
  const headerKeys = getManifestSectionItemKeys(manifest?.column_headers);

  return {
    data: headerKeys.reduce((result, itemKey) => {
      result[itemKey] = STANDINGS_COLUMN_HEADER_LABELS[itemKey] || humanizeLabel(itemKey);
      return result;
    }, {}),
    item: headerKeys,
  };
}

function getStandingsTitleValue(selectedData, options = {}) {
  const roundValue = options.selectedRound || selectedData?.competition?.round;

  if (options.requiresRoundSelection && roundValue !== null && roundValue !== undefined && roundValue !== "") {
    return `Round ${roundValue}`;
  }

  return "Standing";
}

function buildStandingsPoolPayloads(selectedData, selectedDataType, manifest, options = {}) {
  const pools = getStandingsPools(selectedData);
  const standingFields = Array.isArray(manifest?.standings_list?.fields) ? manifest.standings_list.fields : [];
  const standingKeys = getManifestSectionItemKeys(manifest?.standings_list);
  const titleValue = getStandingsTitleValue(selectedData, options);
  const standingRowLimit = Math.max(standingFields.length || 0, 1);

  return pools
    .flatMap((pool, poolIndex) => {
      const normalizedRows = pool.rows.map((row, rowIndex) => ({
        bonus: normalizeStandingsValue(
          getValueByAliases(row, ["bonus", "bonusPoints", "bonus_points", "b"])
        ),
        difference: normalizeStandingsValue(
          getValueByAliases(row, ["difference", "pointsDifference", "pointDifference", "pointsDiff", "diff"])
        ),
        drawn: normalizeStandingsValue(getValueByAliases(row, ["drawn", "draw", "draws", "tied"])),
        lost: normalizeStandingsValue(getValueByAliases(row, ["lost", "losses", "l"])),
        played: normalizeStandingsValue(getValueByAliases(row, ["played", "matchesPlayed", "p"])),
        points: normalizeStandingsValue(getValueByAliases(row, ["points", "pts", "tablePoints"])),
        pool_number: getPoolNumber(pool.source, row, poolIndex),
        position: normalizeStandingsValue(getValueByAliases(row, ["position", "rank", "pos"]) || rowIndex + 1),
        team_logo: normalizeStandingsValue(
          getValueByAliases(row, [
            "team_logo",
            "teamLogo",
            "team.logo",
            "team.image",
            "team.badge",
            "team.crest",
            "logo",
            "image",
          ])
        ),
        team_name: normalizeStandingsValue(
          getValueByAliases(row, ["team_name", "teamName", "team.shortName", "team.name", "name"])
        ),
        won: normalizeStandingsValue(getValueByAliases(row, ["won", "wins", "w"])),
      }));

      const pageCount = Math.ceil(normalizedRows.length / standingRowLimit);

      return Array.from({ length: pageCount }, (_, pageIndex) => {
        const rows = normalizedRows
          .slice(pageIndex * standingRowLimit, (pageIndex + 1) * standingRowLimit)
          .map((row) =>
            standingKeys.reduce((result, itemKey) => {
              result[itemKey] = getStandingsItemValue(itemKey, row);
              return result;
            }, {})
          );

        if (!rows.length) {
          return null;
        }

        const poolName = pool.poolName;
        const payloadData = {
          standings_list: {
            data: rows,
            list_item: standingKeys,
          },
        };

        if (isRecord(manifest?.column_headers)) {
          payloadData.column_headers = buildStandingsColumnHeaders(manifest);
        }

        if (isRecord(manifest?.pool_name)) {
          payloadData.pool_name = buildManifestSectionData(manifest?.pool_name, poolName, ["pool_name", "poolName", "name"]);
        }

        if (isRecord(manifest?.title)) {
          payloadData.title = buildManifestSectionData(manifest?.title, titleValue, ["title", "name"]);
        }

        const basePageTitle = isRecord(manifest?.pool_name) ? `${titleValue} | ${poolName}` : titleValue;

        return {
          data: payloadData,
          pageNumber: pageIndex + 1,
          pageTitle: pageCount > 1 ? `${basePageTitle} | Page ${pageIndex + 1}` : basePageTitle,
          poolName,
          previewLabel: pageCount > 1 ? `${poolName} | Page ${pageIndex + 1}` : poolName,
          totalPages: pageCount,
        };
      });
    })
    .filter(Boolean);
}

function buildFilteredSelectedData(selectedData, selectedFieldPaths, options = {}) {
  if (!selectedData) {
    return null;
  }

  if (options.previewMode === "standings") {
    return options.standingsPoolPayloads?.[0]?.data || null;
  }

  if (options.previewMode === "top-player-scores") {
    return buildFilteredTopPlayerScoresData(selectedData, selectedFieldPaths, options.topPlayerItems || []);
  }

  if (options.previewMode === "head-to-head") {
    return buildFilteredHeadToHeadData(selectedData, selectedFieldPaths, {
      summaryItems: options.headToHeadSummaryItems || [],
      matchItems: options.headToHeadMatchItems || [],
      formItems: options.headToHeadFormItems || [],
    });
  }

  if (options.previewMode === "player-stats") {
    return buildManifestLikePlayerStatsData(selectedData, options.playerStatsSelection, selectedFieldPaths, {
      manifest: options.matchStatsManifest,
      suffixByPath: options.matchStatsSuffixByPath,
    });
  }

  if (isMatchStatsPayload(selectedData)) {
    return buildManifestLikeMatchStatsData(selectedData, selectedFieldPaths, {
      manifest: options.matchStatsManifest,
      suffixByPath: options.matchStatsSuffixByPath,
    });
  }

  if (isTeamSheetsPayload(selectedData)) {
    return buildManifestLikeTeamSheetData(selectedData, options.teamSheetSelection, options.teamSheetManifestSections);
  }

  const groups = Array.isArray(selectedData.groups) ? selectedData.groups : [];

  if (!groups.length) {
    return selectedData;
  }

  if (!selectedFieldPaths.length) {
    return {
      competition: selectedData.competition ?? null,
      season: selectedData.season ?? null,
      groups: [],
    };
  }

  const selectionTree = buildSelectionTree(selectedFieldPaths);
  const filteredGroups = groups
    .map((group) => filterValueBySelection(group, selectionTree))
    .filter((group) => group !== undefined);

  return {
    competition: selectedData.competition ?? null,
    season: selectedData.season ?? null,
    groups: filteredGroups,
  };
}

function flattenTableRow(value, parentPath = "", flattened = {}) {
  if (Array.isArray(value)) {
    flattened[parentPath] = stringifyJson(value);
    return flattened;
  }

  if (isRecord(value)) {
    Object.entries(value).forEach(([key, nestedValue]) => {
      const nextPath = parentPath ? `${parentPath}.${key}` : key;

      if (isRecord(nestedValue)) {
        flattenTableRow(nestedValue, nextPath, flattened);
        return;
      }

      flattened[nextPath] = nestedValue;
    });

    return flattened;
  }

  if (parentPath) {
    flattened[parentPath] = value;
  }

  return flattened;
}

function formatTableCellValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value) || isRecord(value)) {
    return stringifyJson(value);
  }

  return String(value);
}

const STAT_OPTIONS = [
  "tryScored",
  "points",
  "minutesPlayed",
  "carries",
  "offload",
  "tryAssist",
  "defenderBeaten",
  "missedTackle",
  "lineoutSteals",
  "lineoutThrowsWon",
  "kicksInPlay",
  "kickMetres",
  "retainedKick",
  "dominantContact",
  "dominantTackleContact",
  "totalSuccessfulTackles",
  "kickBox",
  "totalTurnoversWon",
  "attackingCatchSuccess",
  "successfulGoals",
  "metresMade",
  "postContactMetres",
  "kickBounced",
  "initialBreak",
  "goalKickSuccessPercent",
  "tackleSuccessPercent",
  "retainedKicksPercent",
  "lineoutSuccessPercent",
  "metresPerCarry",
  "postContactMetresPerCarry",
  "totalJackals",
  "kickMetresPerKick",
];

const COVERAGE_OPTIONS = ["basic", "performance"];
const ROUND_OPTIONS = Array.from({ length: 16 }, (_, index) => String(index + 1));

export default function PageCreationOverlay({ selectedDataType, onClose, onConfirm }) {
  const { matchId } = useParams();
  const { state, setSelectedElementCollectionUri } = useAppFlow();
  const [selectedData, setSelectedData] = useState(null);
  const [selectedFieldPaths, setSelectedFieldPaths] = useState([]);
  const [selectedMatchStatsSuffixByPath, setSelectedMatchStatsSuffixByPath] = useState({});
  const [shows, setShows] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedShowId, setSelectedShowId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedManifest, setSelectedManifest] = useState(null);
  const [preparedTemplate, setPreparedTemplate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [error, setError] = useState("");
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [preparingTemplate, setPreparingTemplate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);
  const [selectedStat, setSelectedStat] = useState("");
  const [selectedCoverage, setSelectedCoverage] = useState("");
  const [selectedRound, setSelectedRound] = useState("");
  const [selectedTeamSheetTeamKey, setSelectedTeamSheetTeamKey] = useState("");
  const [selectedTeamSheetPlayerIds, setSelectedTeamSheetPlayerIds] = useState([]);
  const [selectedTeamSheetCoachId, setSelectedTeamSheetCoachId] = useState("");
  const [selectedTeamSheetHeadCoachId, setSelectedTeamSheetHeadCoachId] = useState("");
  const [selectedTeamSheetName, setSelectedTeamSheetName] = useState("");
  const [selectedPlayerStatsTeamKey, setSelectedPlayerStatsTeamKey] = useState("");
  const [selectedPlayerStatsPlayerId, setSelectedPlayerStatsPlayerId] = useState("");
  const [teamSheetPlayerImageStatusById, setTeamSheetPlayerImageStatusById] = useState({});
  const [statsPageDefaults, setStatsPageDefaults] = useState({});
  const [loadingStatsPageDefaults, setLoadingStatsPageDefaults] = useState(false);
  const [statsPageDefaultsError, setStatsPageDefaultsError] = useState("");
  const [selectedStatsPageKey, setSelectedStatsPageKey] = useState("");
  const [matchStatsSearchTerm, setMatchStatsSearchTerm] = useState("");
  const [playerStatsSearchTerm, setPlayerStatsSearchTerm] = useState("");

  const requiresStatSelection = useMemo(
    () =>
      Boolean(
        selectedDataType?.requiredParameters?.includes("stat") ||
          /\{stat\}/.test(selectedDataType?.queryUri || "")
      ),
    [selectedDataType]
  );

  const requiresCoverageSelection = useMemo(
    () =>
      Boolean(
        selectedDataType?.requiredParameters?.includes("coverage") ||
          /\{coverage\}/.test(selectedDataType?.queryUri || "")
      ),
    [selectedDataType]
  );

  const requiresRoundSelection = useMemo(
    () =>
      Boolean(
        selectedDataType?.requiredParameters?.includes("round") ||
          /\{round\}/.test(selectedDataType?.queryUri || "")
      ),
    [selectedDataType]
  );

  useEffect(() => {
    setSelectedStat("");
    setSelectedCoverage("");
    setSelectedRound("");
  }, [selectedDataType]);

  const groupColumns = useMemo(() => {
    const groups = Array.isArray(selectedData?.groups) ? selectedData.groups : [];

    if (!groups.length) {
      return [];
    }

    return Array.from(
      groups.reduce((columnSet, group) => {
        Object.keys(flattenTableRow(group)).forEach((key) => columnSet.add(key));
        return columnSet;
      }, new Set())
    );
  }, [selectedData]);

  const teamSheetManifestSections = useMemo(
    () => getTeamSheetManifestSections(selectedManifest || preparedTemplate?.mapping),
    [preparedTemplate?.mapping, selectedManifest]
  );

  const isTeamSheetReplacementMode = useMemo(
    () => isTeamSheetReplacementsManifest(teamSheetManifestSections),
    [teamSheetManifestSections]
  );

  const teamSheetPlayerLimit = useMemo(() => {
    const fieldRows = Array.isArray(teamSheetManifestSections?.playersList?.fields)
      ? teamSheetManifestSections.playersList.fields
      : [];

    return fieldRows.length || 23;
  }, [teamSheetManifestSections]);

  const teamSheetTeamOptions = useMemo(() => {
    if (!isTeamSheetsPayload(selectedData) || isMatchStatsPayload(selectedData)) {
      return [];
    }

    return buildTeamSheetTeamOptions(selectedData);
  }, [selectedData]);

  const teamSheetPresetFields = useMemo(() => getTeamSheetPresetFields(selectedDataType), [selectedDataType]);

  const teamSheetPresetSelection = useMemo(
    () => resolveTeamSheetPresetSelection(teamSheetTeamOptions, teamSheetPresetFields, teamSheetPlayerLimit),
    [teamSheetPlayerLimit, teamSheetPresetFields, teamSheetTeamOptions]
  );

  const playerStatsTeamOptions = useMemo(() => {
    if (!isPlayerStatsDataType(selectedDataType) || !isTeamSheetsPayload(selectedData)) {
      return [];
    }

    return buildTeamSheetTeamOptions(selectedData);
  }, [selectedData, selectedDataType]);

  const standingsPoolPayloads = useMemo(() => {
    if (!isStandingsManifest(selectedManifest) || !Array.isArray(selectedData?.groups)) {
      return [];
    }

    return buildStandingsPoolPayloads(selectedData, selectedDataType, selectedManifest, {
      requiresRoundSelection,
      selectedRound,
    });
  }, [requiresRoundSelection, selectedData, selectedDataType, selectedManifest, selectedRound]);

  const topPlayerItems = useMemo(() => {
    if (!isTopPlayerScoresDataType(selectedDataType) || !selectedData) {
      return [];
    }

    return buildTopPlayerSelectableItems(selectedData, selectedDataType);
  }, [selectedData, selectedDataType]);

  const topPlayerSections = useMemo(() => {
    const sections = new Map();

    topPlayerItems.forEach((item) => {
      if (!sections.has(item.sectionPath)) {
        sections.set(item.sectionPath, {
          items: [],
          path: item.sectionPath,
          title: item.sectionLabel,
        });
      }

      sections.get(item.sectionPath).items.push(item);
    });

    return Array.from(sections.values());
  }, [topPlayerItems]);

  const headToHeadSummaryItems = useMemo(() => {
    if (!isHeadToHeadPayload(selectedData)) {
      return [];
    }

    return buildHeadToHeadSummaryItems(selectedData);
  }, [selectedData]);

  const headToHeadMatchItems = useMemo(() => {
    if (!isHeadToHeadPayload(selectedData)) {
      return [];
    }

    return buildHeadToHeadMatchItems(selectedData);
  }, [selectedData]);

  const headToHeadFormItems = useMemo(() => {
    if (!isHeadToHeadPayload(selectedData)) {
      return [];
    }

    return buildHeadToHeadFormItems(selectedData);
  }, [selectedData]);

  const teamStatPaths = useMemo(() => {
    if (!isMatchStatsPayload(selectedData)) {
      return [];
    }

    return collectTeamStatPaths(selectedData?.homeTeam?.teamStats, selectedData?.awayTeam?.teamStats).sort(
      (left, right) => left.localeCompare(right)
    );
  }, [selectedData]);

  const matchStatsSelectionLimit = useMemo(
    () => getMatchStatsSelectionLimit(selectedManifest || preparedTemplate?.mapping),
    [preparedTemplate?.mapping, selectedManifest]
  );

  const matchStatItems = useMemo(
    () => getMatchStatSelectableItems(selectedData, teamStatPaths),
    [selectedData, teamStatPaths]
  );

  const selectedPlayerStatsTeam = useMemo(
    () => playerStatsTeamOptions.find((teamOption) => teamOption.teamKey === selectedPlayerStatsTeamKey) || null,
    [playerStatsTeamOptions, selectedPlayerStatsTeamKey]
  );

  const selectedPlayerStatsPlayer = useMemo(
    () => selectedPlayerStatsTeam?.players?.find((player) => player.id === selectedPlayerStatsPlayerId) || null,
    [selectedPlayerStatsPlayerId, selectedPlayerStatsTeam]
  );

  const playerStatPaths = useMemo(
    () =>
      selectedPlayerStatsPlayer?.raw?.stats
        ? collectPlayerStatPaths(selectedPlayerStatsPlayer.raw.stats).sort((left, right) => left.localeCompare(right))
        : [],
    [selectedPlayerStatsPlayer]
  );

  const playerStatItems = useMemo(
    () => getPlayerStatSelectableItems(selectedPlayerStatsPlayer?.raw || null, playerStatPaths),
    [playerStatPaths, selectedPlayerStatsPlayer]
  );

  const statsPageOptions = useMemo(
    () => Object.keys(statsPageDefaults).filter((key) => Array.isArray(statsPageDefaults[key]) && statsPageDefaults[key].length),
    [statsPageDefaults]
  );

  const resolvedMatchStatsDefaults = useMemo(
    () =>
      resolveMatchStatDefaultsForPage(
        matchStatItems,
        statsPageDefaults,
        selectedStatsPageKey,
        matchStatsSelectionLimit,
        {
          useAllPages: isMatchStatsScene4012Manifest(selectedManifest || preparedTemplate?.mapping),
        }
      ),
    [matchStatItems, matchStatsSelectionLimit, preparedTemplate?.mapping, selectedManifest, selectedStatsPageKey, statsPageDefaults]
  );

  const resolvedPlayerStatsDefaults = useMemo(
    () =>
      resolveMatchStatDefaultsForPage(
        playerStatItems,
        statsPageDefaults,
        selectedStatsPageKey,
        matchStatsSelectionLimit
      ),
    [matchStatsSelectionLimit, playerStatItems, selectedStatsPageKey, statsPageDefaults]
  );

  const orderedMatchStatItems = useMemo(
    () => resolvedMatchStatsDefaults.orderedItems,
    [resolvedMatchStatsDefaults]
  );

  const orderedPlayerStatItems = useMemo(
    () => resolvedPlayerStatsDefaults.orderedItems,
    [resolvedPlayerStatsDefaults]
  );

  const visibleMatchStatItems = useMemo(
    () => getRankedStatItemsByQuery(orderedMatchStatItems, matchStatsSearchTerm),
    [matchStatsSearchTerm, orderedMatchStatItems]
  );

  const visiblePlayerStatItems = useMemo(
    () => getRankedStatItemsByQuery(orderedPlayerStatItems, playerStatsSearchTerm),
    [orderedPlayerStatItems, playerStatsSearchTerm]
  );

  const previewMode = useMemo(() => {
    if (standingsPoolPayloads.length) {
      return "standings";
    }

    if (groupColumns.length) {
      return "groups";
    }

    if (headToHeadSummaryItems.length || headToHeadMatchItems.length || headToHeadFormItems.length) {
      return "head-to-head";
    }

    if (topPlayerItems.length) {
      return "top-player-scores";
    }

    if (isPlayerStatsDataType(selectedDataType) && playerStatsTeamOptions.length) {
      return "player-stats";
    }

    if (teamStatPaths.length) {
      return "match-stats";
    }

    if (teamSheetTeamOptions.length) {
      return "team-sheets";
    }

    return "json";
  }, [groupColumns, headToHeadFormItems.length, headToHeadMatchItems.length, headToHeadSummaryItems.length, playerStatsTeamOptions.length, selectedDataType, standingsPoolPayloads.length, teamSheetTeamOptions.length, teamStatPaths, topPlayerItems.length]);

  useEffect(() => {
    if (previewMode !== "team-sheets") {
      setTeamSheetPlayerImageStatusById({});
      return;
    }

    const fallbackTeamKey = teamSheetPresetSelection?.teamKey || teamSheetTeamOptions[0]?.teamKey || "";

    setSelectedTeamSheetTeamKey((currentTeamKey) => {
      if (!fallbackTeamKey) {
        return "";
      }

      if (!teamSheetPresetSelection?.teamKey && teamSheetTeamOptions.some((teamOption) => teamOption.teamKey === currentTeamKey)) {
        return currentTeamKey;
      }

      return fallbackTeamKey;
    });
  }, [previewMode, teamSheetPresetSelection?.teamKey, teamSheetTeamOptions]);

  useEffect(() => {
    if (previewMode !== "player-stats") {
      return;
    }

    const fallbackTeamKey = playerStatsTeamOptions[0]?.teamKey || "";
    setSelectedPlayerStatsTeamKey((currentTeamKey) =>
      playerStatsTeamOptions.some((teamOption) => teamOption.teamKey === currentTeamKey) ? currentTeamKey : fallbackTeamKey
    );
  }, [playerStatsTeamOptions, previewMode]);

  useEffect(() => {
    if (previewMode !== "player-stats") {
      return;
    }

    const fallbackPlayerId = selectedPlayerStatsTeam?.players?.[0]?.id || "";
    setSelectedPlayerStatsPlayerId((currentPlayerId) =>
      selectedPlayerStatsTeam?.players?.some((player) => player.id === currentPlayerId) ? currentPlayerId : fallbackPlayerId
    );
  }, [previewMode, selectedPlayerStatsTeam]);

  useEffect(() => {
    setSubmitStatus(null);
    setTeamSheetPlayerImageStatusById({});
  }, [previewMode, selectedTeamSheetTeamKey]);

  useEffect(() => {
    if (previewMode !== "team-sheets") {
      return;
    }

    setTeamSheetPlayerImageStatusById((currentStatusById) =>
      Object.fromEntries(
        Object.entries(currentStatusById).filter(([playerId]) => selectedTeamSheetPlayerIds.includes(playerId))
      )
    );
  }, [previewMode, selectedTeamSheetPlayerIds]);

  const selectedTeamSheetTeam = useMemo(
    () => teamSheetTeamOptions.find((teamOption) => teamOption.teamKey === selectedTeamSheetTeamKey) || null,
    [selectedTeamSheetTeamKey, teamSheetTeamOptions]
  );

  useEffect(() => {
    if (previewMode !== "team-sheets") {
      return;
    }

    if (!selectedTeamSheetTeam) {
      setSelectedTeamSheetPlayerIds([]);
      setSelectedTeamSheetCoachId("");
      setSelectedTeamSheetHeadCoachId("");
      setSelectedTeamSheetName("");
      return;
    }

    const teamPreset =
      teamSheetPresetSelection?.teamKey === selectedTeamSheetTeam.teamKey ? teamSheetPresetSelection : null;
    const defaultCoachSelection = getDefaultTeamSheetCoachSelections(selectedTeamSheetTeam);
    const defaultPlayerIds = selectedTeamSheetTeam.players
      .slice(0, teamSheetPlayerLimit)
      .map((player) => player.id);

    setSelectedTeamSheetPlayerIds((currentIds) => {
      const validCurrentIds = currentIds.filter((playerId) =>
        selectedTeamSheetTeam.players.some((player) => player.id === playerId)
      );

      if (teamPreset?.playerIds?.length) {
        return teamPreset.playerIds;
      }

      if (validCurrentIds.length) {
        return validCurrentIds.slice(0, teamSheetPlayerLimit);
      }

      return defaultPlayerIds;
    });

    setSelectedTeamSheetCoachId((currentCoachId) => {
      if (teamPreset?.coachId && selectedTeamSheetTeam.coaches.some((coach) => coach.id === teamPreset.coachId)) {
        return teamPreset.coachId;
      }

      if (selectedTeamSheetTeam.coaches.some((coach) => coach.id === currentCoachId)) {
        return currentCoachId;
      }

      return defaultCoachSelection.coachId;
    });

    setSelectedTeamSheetHeadCoachId((currentHeadCoachId) => {
      if (
        teamPreset?.headCoachId &&
        selectedTeamSheetTeam.coaches.some((coach) => coach.id === teamPreset.headCoachId)
      ) {
        return teamPreset.headCoachId;
      }

      if (selectedTeamSheetTeam.coaches.some((coach) => coach.id === currentHeadCoachId)) {
        return currentHeadCoachId;
      }

      return defaultCoachSelection.headCoachId;
    });

    setSelectedTeamSheetName((currentTeamName) => {
      if (
        teamPreset?.teamName &&
        selectedTeamSheetTeam.teamNameOptions.some((teamNameOption) => teamNameOption.value === teamPreset.teamName)
      ) {
        return teamPreset.teamName;
      }

      if (selectedTeamSheetTeam.teamNameOptions.some((teamNameOption) => teamNameOption.value === currentTeamName)) {
        return currentTeamName;
      }

      return selectedTeamSheetTeam.teamNameOptions[0]?.value || "";
    });
  }, [previewMode, selectedTeamSheetTeam, teamSheetPlayerLimit, teamSheetPresetSelection]);

  const teamSheetSelection = useMemo(() => {
    if (!selectedTeamSheetTeam) {
      return null;
    }

    return {
      coachId: selectedTeamSheetCoachId,
      headCoachId: selectedTeamSheetHeadCoachId,
      playerIds: selectedTeamSheetPlayerIds,
      teamName: selectedTeamSheetName,
      teamOption: selectedTeamSheetTeam,
    };
  }, [selectedTeamSheetCoachId, selectedTeamSheetHeadCoachId, selectedTeamSheetName, selectedTeamSheetPlayerIds, selectedTeamSheetTeam]);

  const teamSheetSelectionCount = useMemo(
    () => {
      if (isTeamSheetReplacementMode) {
        const homeLimit = teamSheetManifestSections?.homeTeamReplacements?.fields?.length || 0;
        const awayLimit = teamSheetManifestSections?.awayTeamReplacements?.fields?.length || 0;
        const homeCount = sortPlayersByShirtNumber((selectedData?.homeTeam?.players || []).filter((player) => isSubstitutePlayer(player))).slice(0, homeLimit).length;
        const awayCount = sortPlayersByShirtNumber((selectedData?.awayTeam?.players || []).filter((player) => isSubstitutePlayer(player))).slice(0, awayLimit).length;
        return homeCount + awayCount;
      }

      return (
        selectedTeamSheetPlayerIds.length +
        Number(Boolean(selectedTeamSheetCoachId)) +
        Number(Boolean(selectedTeamSheetHeadCoachId)) +
        Number(Boolean(selectedTeamSheetName))
      );
    },
    [
      isTeamSheetReplacementMode,
      selectedData,
      selectedTeamSheetCoachId,
      selectedTeamSheetHeadCoachId,
      selectedTeamSheetName,
      selectedTeamSheetPlayerIds.length,
      teamSheetManifestSections,
    ]
  );

  const hasEnoughTeamSheetPlayers = useMemo(
    () => Boolean(selectedTeamSheetTeam && selectedTeamSheetTeam.players.length >= teamSheetPlayerLimit),
    [selectedTeamSheetTeam, teamSheetPlayerLimit]
  );

  const hasCompleteTeamSheetSelection = useMemo(
    () => {
      if (isTeamSheetReplacementMode) {
        return Boolean(selectedData?.homeTeam && selectedData?.awayTeam);
      }

      const requiresCoach = Boolean(teamSheetManifestSections?.coach?.itemKeys?.length);
      const requiresHeadCoach = Boolean(teamSheetManifestSections?.headCoach?.itemKeys?.length);

      return Boolean(
        selectedTeamSheetTeam &&
          selectedTeamSheetName &&
          (!requiresCoach || selectedTeamSheetCoachId) &&
          (!requiresHeadCoach || selectedTeamSheetHeadCoachId) &&
          selectedTeamSheetPlayerIds.length === teamSheetPlayerLimit
      );
    },
    [
      isTeamSheetReplacementMode,
      selectedData,
      selectedTeamSheetCoachId,
      selectedTeamSheetHeadCoachId,
      selectedTeamSheetName,
      selectedTeamSheetPlayerIds.length,
      selectedTeamSheetTeam,
      teamSheetManifestSections,
      teamSheetPlayerLimit,
    ]
  );

  useEffect(() => {
    setSelectedMatchStatsSuffixByPath((currentSuffixByPath) => {
      const previewPaths = previewMode === "player-stats" ? playerStatPaths : teamStatPaths;

      if (!previewPaths.length) {
        return {};
      }

      return previewPaths.reduce((result, path) => {
        result[path] = currentSuffixByPath[path] ?? getDefaultMatchStatSuffix(path);
        return result;
      }, {});
    });
  }, [playerStatPaths, previewMode, teamStatPaths]);

  useEffect(() => {
    let mounted = true;

    if (!["match-stats", "player-stats"].includes(previewMode)) {
      setStatsPageDefaults({});
      setStatsPageDefaultsError("");
      setSelectedStatsPageKey("");
      setLoadingStatsPageDefaults(false);
      return () => {
        mounted = false;
      };
    }

    async function loadStatsPageDefaults() {
      setLoadingStatsPageDefaults(true);
      setStatsPageDefaultsError("");

      try {
        const defaults = await getActiveProfileStatsPageDefaults();
        if (!mounted) {
          return;
        }

        setStatsPageDefaults(defaults);
      } catch (loadError) {
        if (!mounted) {
          return;
        }

        const message = notifyRequestError(
          loadError.message,
          "Default stats fetch failed. Failed to load default stats pages."
        );
        setStatsPageDefaults({});
        setStatsPageDefaultsError(message);
      } finally {
        if (mounted) {
          setLoadingStatsPageDefaults(false);
        }
      }
    }

    loadStatsPageDefaults();

    return () => {
      mounted = false;
    };
  }, [previewMode, state.activeProfile?.name]);

  useEffect(() => {
    if (!statsPageOptions.length) {
      setSelectedStatsPageKey("");
      return;
    }

    setSelectedStatsPageKey((currentPageKey) =>
      statsPageOptions.includes(currentPageKey) ? currentPageKey : statsPageOptions[0]
    );
  }, [statsPageOptions]);

  useEffect(() => {
    if (previewMode === "standings") {
      setSelectedFieldPaths([]);
      return;
    }

    if (previewMode === "groups") {
      setSelectedFieldPaths(groupColumns);
      return;
    }

    if (previewMode === "match-stats") {
      setSelectedFieldPaths(resolvedMatchStatsDefaults.selectedPaths);
      return;
    }

    if (previewMode === "player-stats") {
      setSelectedFieldPaths(resolvedPlayerStatsDefaults.selectedPaths);
      return;
    }

    if (previewMode === "head-to-head") {
      setSelectedFieldPaths([
        ...headToHeadSummaryItems.map((item) => item.id),
        ...headToHeadMatchItems.map((item) => item.id),
        ...headToHeadFormItems.map((item) => item.id),
      ]);
      return;
    }

    if (previewMode === "top-player-scores") {
      setSelectedFieldPaths(topPlayerItems.map((item) => item.id));
      return;
    }

    if (previewMode === "team-sheets") {
      setSelectedFieldPaths([]);
      return;
    }

    setSelectedFieldPaths([]);
  }, [groupColumns, headToHeadFormItems, headToHeadMatchItems, headToHeadSummaryItems, previewMode, resolvedMatchStatsDefaults.selectedPaths, resolvedPlayerStatsDefaults.selectedPaths, topPlayerItems]);

  useEffect(() => {
    if (!["match-stats", "player-stats"].includes(previewMode)) {
      return;
    }

    setSelectedFieldPaths((currentPaths) => currentPaths.slice(0, matchStatsSelectionLimit));
  }, [matchStatsSelectionLimit, previewMode]);

  const selectedFieldPathSet = useMemo(() => new Set(selectedFieldPaths), [selectedFieldPaths]);

  const filteredSelectedData = useMemo(
    () =>
      buildFilteredSelectedData(selectedData, selectedFieldPaths, {
        headToHeadFormItems,
        headToHeadMatchItems,
        headToHeadSummaryItems,
        matchStatsManifest: selectedManifest || preparedTemplate?.mapping,
        matchStatsSuffixByPath: selectedMatchStatsSuffixByPath,
        playerStatsSelection: {
          player: selectedPlayerStatsPlayer,
          teamOption: selectedPlayerStatsTeam,
        },
        previewMode,
        standingsPoolPayloads,
        teamSheetManifestSections,
        teamSheetSelection,
        topPlayerItems,
      }),
    [headToHeadFormItems, headToHeadMatchItems, headToHeadSummaryItems, preparedTemplate?.mapping, previewMode, selectedData, selectedFieldPaths, selectedMatchStatsSuffixByPath, selectedManifest, selectedPlayerStatsPlayer, selectedPlayerStatsTeam, standingsPoolPayloads, teamSheetManifestSections, teamSheetSelection, topPlayerItems]
  );

  const filteredGroupsTable = useMemo(() => {
    const groups = filteredSelectedData?.groups;

    if (!Array.isArray(groups) || !groups.length) {
      return null;
    }

    const rows = groups.map((group) => flattenTableRow(group));
    const columns = Array.from(
      rows.reduce((columnSet, row) => {
        Object.keys(row).forEach((key) => columnSet.add(key));
        return columnSet;
      }, new Set())
    );

    return {
      columns,
      rows,
    };
  }, [filteredSelectedData]);

  const filteredTeamStatsList = useMemo(() => {
    if (!["match-stats", "player-stats"].includes(previewMode)) {
      return [];
    }

    if (previewMode === "player-stats") {
      return Array.isArray(filteredSelectedData?.stats_list?.data) ? filteredSelectedData.stats_list.data : [];
    }

    return Array.isArray(filteredSelectedData?.statistics_list?.data) ? filteredSelectedData.statistics_list.data : [];
  }, [filteredSelectedData, previewMode]);

  const filteredTopPlayerItems = useMemo(() => {
    if (previewMode !== "top-player-scores") {
      return [];
    }

    const selectedIdSet = new Set(selectedFieldPaths);
    return topPlayerItems.filter((item) => selectedIdSet.has(item.id));
  }, [previewMode, selectedFieldPaths, topPlayerItems]);

  const filteredTopPlayerSections = useMemo(() => {
    if (previewMode !== "top-player-scores") {
      return [];
    }

    const selectedIdSet = new Set(selectedFieldPaths);

    return topPlayerSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => selectedIdSet.has(item.id)),
      }))
      .filter((section) => section.items.length);
  }, [previewMode, selectedFieldPaths, topPlayerSections]);

  const filteredHeadToHeadSummaryItems = useMemo(() => {
    if (previewMode !== "head-to-head") {
      return [];
    }

    return headToHeadSummaryItems.filter((item) => selectedFieldPathSet.has(item.id));
  }, [headToHeadSummaryItems, previewMode, selectedFieldPathSet]);

  const filteredHeadToHeadMatchItems = useMemo(() => {
    if (previewMode !== "head-to-head") {
      return [];
    }

    return headToHeadMatchItems.filter((item) => selectedFieldPathSet.has(item.id));
  }, [headToHeadMatchItems, previewMode, selectedFieldPathSet]);

  const filteredHeadToHeadFormSections = useMemo(() => {
    if (previewMode !== "head-to-head") {
      return [];
    }

    const sections = new Map();

    headToHeadFormItems.forEach((item) => {
      if (!sections.has(item.teamKey)) {
        sections.set(item.teamKey, {
          teamKey: item.teamKey,
          title: item.teamLabel,
          items: [],
        });
      }

      if (selectedFieldPathSet.has(item.id)) {
        sections.get(item.teamKey).items.push(item);
      }
    });

    return Array.from(sections.values()).filter((section) => section.items.length);
  }, [headToHeadFormItems, previewMode, selectedFieldPathSet]);

  const previewSelectionCount = useMemo(
    () =>
      previewMode === "team-sheets"
        ? teamSheetSelectionCount
        : previewMode === "standings"
          ? standingsPoolPayloads.length
          : selectedFieldPaths.length,
    [previewMode, selectedFieldPaths.length, standingsPoolPayloads.length, teamSheetSelectionCount]
  );

  const homeTeamLabel = useMemo(
    () =>
      selectedData?.teams?.homeTeam?.name ||
      selectedData?.homeTeam?.team?.shortName ||
      selectedData?.homeTeam?.team?.name ||
      "Home",
    [selectedData]
  );

  const awayTeamLabel = useMemo(
    () =>
      selectedData?.teams?.awayTeam?.name ||
      selectedData?.awayTeam?.team?.shortName ||
      selectedData?.awayTeam?.team?.name ||
      "Away",
    [selectedData]
  );

  const titleText = useMemo(() => {
    if (previewMode === "head-to-head") {
      const homeName = selectedData?.teams?.homeTeam?.name || "Home Team";
      const awayName = selectedData?.teams?.awayTeam?.name || "Away Team";
      return `${homeName} vs ${awayName}`;
    }

    if (previewMode === "standings") {
      return selectedDataType?.dataType || "Standings";
    }

    if (previewMode === "top-player-scores") {
      return selectedDataType?.dataType || "Top 10 Players";
    }

    if (previewMode === "player-stats") {
      const teamName = selectedPlayerStatsTeam?.teamData?.team?.name || "Team";
      const playerName = selectedPlayerStatsPlayer?.primary || "Player";
      return `${teamName} | ${playerName}`;
    }

    if (previewMode === "match-stats") {
      const homeName = selectedData?.homeTeam?.team?.name || "Home Team";
      const awayName = selectedData?.awayTeam?.team?.name || "Away Team";
      return `${homeName} vs ${awayName}`;
    }

    if (previewMode === "team-sheets") {
      const homeName = selectedData?.homeTeam?.team?.name || "Home Team";
      const awayName = selectedData?.awayTeam?.team?.name || "Away Team";
      return `${homeName} vs ${awayName}`;
    }

    const competitionName = filteredSelectedData?.competition?.name || selectedData?.competition?.name || "Competition";
    const seasonName = filteredSelectedData?.season?.name || selectedData?.season?.name || "Season";

    return `${competitionName} | ${seasonName}`;
  }, [filteredSelectedData, previewMode, selectedData, selectedDataType?.dataType, selectedPlayerStatsPlayer?.primary, selectedPlayerStatsTeam?.teamData?.team?.name]);

  const subtitleText = useMemo(() => {
    if (previewMode === "head-to-head") {
      const competitionName = selectedData?.matchInfo?.competition?.seasonName || selectedData?.matchInfo?.competition?.name;
      const seasonName = selectedData?.matchInfo?.season?.name;
      const venueName = selectedData?.matchInfo?.venue?.name;
      return [competitionName, seasonName, venueName].filter(Boolean).join(" | ");
    }

    if (previewMode === "standings") {
      const competitionName = selectedData?.competition?.name;
      const seasonName = selectedData?.season?.name;
      const titleValue = getStandingsTitleValue(selectedData, { requiresRoundSelection, selectedRound });
      return [competitionName, seasonName, titleValue].filter(Boolean).join(" | ");
    }

    if (previewMode === "top-player-scores") {
      const competitionName = selectedData?.competition?.name;
      const seasonName = selectedData?.season?.name;
      const statName = selectedDataType?.type;
      return [competitionName, seasonName, statName].filter(Boolean).join(" | ");
    }

    if (previewMode === "player-stats") {
      const competitionName = selectedData?.competition?.name;
      const seasonName = selectedData?.season?.name;
      const positionName = selectedPlayerStatsPlayer?.raw?.position?.name
        ? humanizeLabel(selectedPlayerStatsPlayer.raw.position.name)
        : null;
      return [competitionName, seasonName, positionName].filter(Boolean).join(" | ");
    }

    if (previewMode === "match-stats") {
      const competitionName = selectedData?.competition?.name;
      const seasonName = selectedData?.season?.name;
      const round = selectedData?.round;
      const segments = [competitionName, seasonName].filter(Boolean);

      if (round !== null && round !== undefined && round !== "") {
        segments.push(`Round ${round}`);
      }

      return segments.join(" | ");
    }

    if (previewMode === "team-sheets") {
      const competitionName = selectedData?.competition?.name;
      const seasonName = selectedData?.season?.name;
      const venueName = selectedData?.venue?.name;
      return [competitionName, seasonName, venueName].filter(Boolean).join(" | ");
    }

    const round = filteredSelectedData?.competition?.round || selectedData?.competition?.round;
    const classification = selectedData?.classification?.name;
    const segments = [];

    if (round !== null && round !== undefined && round !== "") {
      segments.push(`Round ${round}`);
    }

    if (classification) {
      segments.push(classification);
    }

    return segments.join(" | ");
  }, [filteredSelectedData, previewMode, requiresRoundSelection, selectedData, selectedDataType?.type, selectedPlayerStatsPlayer, selectedRound]);

  useEffect(() => {
    let mounted = true;

    async function loadOverlayData() {
      setLoading(true);
      setError("");

      try {
        const [dataPayload, showList] = await Promise.all([
          (requiresStatSelection && !selectedStat) ||
          (requiresCoverageSelection && !selectedCoverage) ||
          (requiresRoundSelection && !selectedRound)
            ? Promise.resolve(null)
            : getRugbyVizSelectedData(selectedDataType, {
                compId: state.selectedCompetitionId,
                seasonId: state.selectedSeasonId,
                matchId: state.selectedMatchId || matchId,
                coverage: selectedCoverage,
                round: selectedRound,
                stat: selectedStat,
                selectedCompetitionId: state.selectedCompetitionId,
                selectedCoverage: selectedCoverage,
                selectedRound: selectedRound,
                selectedSeasonId: state.selectedSeasonId,
                selectedMatchId: state.selectedMatchId || matchId,
                selectedStat: selectedStat,
              }),
          getGraphicShows(),
        ]);

        if (!mounted) {
          return;
        }

        setSelectedData(dataPayload);
        setShows(showList);
        setTemplates([]);
        setSelectedShowId("");
        setSelectedTemplateId("");
        setSelectedManifest(null);
        setSelectedElementCollectionUri("");
      } catch (loadError) {
        if (mounted) {
          const message = notifyRequestError(
            loadError.message,
            "Failed to load page creation data."
          );
          setSelectedData(null);
          setShows([]);
          setTemplates([]);
          setSelectedShowId("");
          setSelectedTemplateId("");
          setSelectedManifest(null);
          setSelectedElementCollectionUri("");
          setError(message);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadOverlayData();

    return () => {
      mounted = false;
    };
  }, [
    matchId,
    requiresCoverageSelection,
    requiresRoundSelection,
    requiresStatSelection,
    selectedCoverage,
    selectedDataType,
    selectedRound,
    selectedStat,
    state.selectedCompetitionId,
    state.selectedMatchId,
    state.selectedSeasonId,
  ]);

  const selectedShow = useMemo(
    () => shows.find((show) => show.id === selectedShowId) || null,
    [selectedShowId, shows]
  );

  useEffect(() => {
    let mounted = true;

    async function loadTemplatesForShow() {
      if (!selectedShow) {
        setTemplates([]);
        setSelectedManifest(null);
        setSelectedElementCollectionUri("");
        return;
      }

      setLoadingTemplates(true);
      setError("");

      try {
        const { elementCollectionUri, templates: templateList } = await getGraphicTemplates(selectedShow.raw);
        if (!mounted) {
          return;
        }

        setTemplates(templateList);
        setSelectedTemplateId("");
        setSelectedManifest(null);
        setSelectedElementCollectionUri(elementCollectionUri);
      } catch (loadError) {
        if (mounted) {
          const message = notifyRequestError(loadError.message, "Failed to load templates.");
          setTemplates([]);
          setSelectedTemplateId("");
          setSelectedManifest(null);
          setSelectedElementCollectionUri("");
          setError(message);
        }
      } finally {
        if (mounted) {
          setLoadingTemplates(false);
        }
      }
    }

    loadTemplatesForShow();

    return () => {
      mounted = false;
    };
  }, [selectedShow]);

  useEffect(() => {
    if (!selectedShowId) {
      setSelectedTemplateId("");
      setSelectedManifest(null);
      setSelectedElementCollectionUri("");
      return;
    }

    const hasSelectedTemplate = templates.some((template) => template.id === selectedTemplateId);
    if (!hasSelectedTemplate) {
      setSelectedTemplateId("");
      setSelectedManifest(null);
    }
  }, [selectedShowId, selectedTemplateId, templates]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId, templates]
  );

  useEffect(() => {
    let mounted = true;

    async function loadManifest() {
      if (!selectedTemplate) {
        setSelectedManifest(null);
        return;
      }

      const manifestId = `${selectedTemplate.name}.json`;
      setLoadingManifest(true);
      setError("");

      try {
        const manifest = await getGraphicManifest(manifestId);
        if (mounted) {
          setSelectedManifest(manifest);
        }
      } catch (loadError) {
        if (mounted) {
          const message = notifyRequestError(loadError.message, "Failed to load graphic manifest.");
          setSelectedManifest(null);
          setError(message);
        }
      } finally {
        if (mounted) {
          setLoadingManifest(false);
        }
      }
    }

    loadManifest();

    return () => {
      mounted = false;
    };
  }, [selectedTemplate]);

  useEffect(() => {
    let mounted = true;

    async function loadPreparedTemplate() {
      if (!selectedTemplate) {
        setPreparedTemplate(null);
        return;
      }

      setPreparingTemplate(true);
      setError("");

      try {
        const response = await prepareGraphicTemplate(selectedTemplate.raw);
        if (mounted) {
          setPreparedTemplate(response);
        }
      } catch (loadError) {
        if (mounted) {
          const message = notifyRequestError(loadError.message, "Failed to prepare template.");
          setPreparedTemplate(null);
          setError(message);
        }
      } finally {
        if (mounted) {
          setPreparingTemplate(false);
        }
      }
    }

    loadPreparedTemplate();

    return () => {
      mounted = false;
    };
  }, [selectedTemplate]);

  const onCreatePage = async () => {
    if (!filteredSelectedData || !preparedTemplate) {
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      setSubmitStatus(null);

      const fieldMapping = selectedManifest || preparedTemplate.mapping;
      const preparedTemplatePayload = {
        ...preparedTemplate,
        elementCollectionUri: state.selectedElementCollectionUri || preparedTemplate.elementCollectionUri,
      };

      if (previewMode === "standings") {
        const createdPages = [];

        for (const poolPayload of standingsPoolPayloads) {
          const fieldValues = buildFieldValuesFromTemplate(fieldMapping, poolPayload.data);
          const createdPage = await createGraphicPage({
            preparedTemplate: preparedTemplatePayload,
            fieldValues,
          });

          createdPages.push({
            createdPage,
            fieldValues,
            pageTitle: poolPayload.pageTitle,
            selectedData: poolPayload.data,
          });
        }

        await onConfirm({
          createdPages,
          selectedCoverage,
          selectedData: filteredSelectedData,
          selectedFieldPaths,
          selectedRound,
          selectedStat,
          template: {
            ...selectedTemplate,
            mapping: fieldMapping,
            templateName: preparedTemplate.templateName,
          },
        });

        setSubmitStatus({
          kind: "success",
          message: `Created ${createdPages.length} pages successfully. Review the result and close the overlay when ready.`,
        });

        return;
      }

      const fieldValues = buildFieldValuesFromTemplate(fieldMapping, filteredSelectedData);
      const createdPage = await createGraphicPage({
        preparedTemplate: preparedTemplatePayload,
        fieldValues,
      });

      await onConfirm({
        createdPage,
        selectedCoverage,
        selectedData: filteredSelectedData,
        selectedFieldPaths,
        selectedRound,
        selectedStat,
        template: {
          ...selectedTemplate,
          mapping: fieldMapping,
          templateName: preparedTemplate.templateName,
        },
        fieldValues,
      });

      if (previewMode === "team-sheets") {
        setTeamSheetPlayerImageStatusById((currentStatusById) => ({
          ...currentStatusById,
          ...Object.fromEntries(selectedTeamSheetPlayerIds.map((playerId) => [playerId, "found"])),
        }));
      }

      setSubmitStatus({
        kind: "success",
        message: "Page created successfully. Review the result and close the overlay when ready.",
      });
    } catch (submitError) {
      const message = notifyRequestError(submitError.message, "Failed to create page.");
      setError(message);

      if (previewMode === "team-sheets" && selectedTeamSheetTeam) {
        const failedPlayerName = getImageResolutionFailureName(message);
        const failedPlayerIds = getTeamSheetPlayerIdsByName(selectedTeamSheetTeam, failedPlayerName);

        if (failedPlayerIds.length) {
          setTeamSheetPlayerImageStatusById((currentStatusById) => ({
            ...currentStatusById,
            ...Object.fromEntries(failedPlayerIds.map((playerId) => [playerId, "missing"])),
          }));
        }
      }

      setSubmitStatus({
        kind: "error",
        message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="modal-overlay page-creation-overlay">
      <div className="modal-card page-creation-overlay__card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header page-creation-overlay__header">
          <div>
            <h3>Create Page</h3>
            <p className="subtitle modal-subtitle">
              {selectedDataType?.dataType || "Data Type"}
              {selectedDataType?.type ? ` | ${selectedDataType.type}` : ""}
              {selectedCoverage ? ` | ${selectedCoverage}` : ""}
              {selectedRound ? ` | Round ${selectedRound}` : ""}
              {selectedStat ? ` | ${selectedStat}` : ""}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close page creation">
            x
          </button>
        </div>

        {requiresCoverageSelection ? (
          <label className="page-creation-overlay__selector">
            <span>Coverage</span>
            <select value={selectedCoverage} onChange={(event) => setSelectedCoverage(event.target.value)}>
              <option value="">Select coverage</option>
              {COVERAGE_OPTIONS.map((coverageOption) => (
                <option key={coverageOption} value={coverageOption}>
                  {coverageOption}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {requiresRoundSelection ? (
          <label className="page-creation-overlay__selector">
            <span>Round</span>
            <select value={selectedRound} onChange={(event) => setSelectedRound(event.target.value)}>
              <option value="">Select round</option>
              {ROUND_OPTIONS.map((roundOption) => (
                <option key={roundOption} value={roundOption}>
                  Round {roundOption}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {requiresStatSelection ? (
          <label className="page-creation-overlay__selector">
            <span>Stat</span>
            <select value={selectedStat} onChange={(event) => setSelectedStat(event.target.value)}>
              <option value="">Select a stat</option>
              {STAT_OPTIONS.map((statOption) => (
                <option key={statOption} value={statOption}>
                  {statOption}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {loading ? <p className="loading">Loading selected data and templates...</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {requiresCoverageSelection && !selectedCoverage && !loading && !error ? (
          <p className="page-creation-overlay__helper">Select coverage to load the source data.</p>
        ) : null}
        {requiresRoundSelection && !selectedRound && !loading && !error ? (
          <p className="page-creation-overlay__helper">Select a round to load the source data.</p>
        ) : null}
        {requiresStatSelection && !selectedStat && !loading && !error ? (
          <p className="page-creation-overlay__helper">Select a stat to load the source data.</p>
        ) : null}

        {!loading &&
        !error &&
        (!requiresCoverageSelection || selectedCoverage) &&
        (!requiresRoundSelection || selectedRound) &&
        (!requiresStatSelection || selectedStat) ? (
          <div className="page-creation-overlay__content">
            <section className="page-creation-overlay__panel">
              <div className="page-creation-overlay__panel-header">
                <div>
                  <h4>{titleText}</h4>
                  {subtitleText ? <p className="page-creation-overlay__title-meta">{subtitleText}</p> : null}
                </div>
                <span>{previewMode === "standings" ? `${previewSelectionCount} pages` : previewSelectionCount}</span>
              </div>

              {previewMode === "standings" ? (
                <div className="page-creation-overlay__preview-block">
                  <div className="page-creation-overlay__panel-header">
                    <h4>Pages</h4>
                    <span>{standingsPoolPayloads.length}</span>
                  </div>

                  <div className="page-creation-overlay__top-players-wrap">
                    <div className="page-creation-overlay__top-players-list">
                      {standingsPoolPayloads.map((poolPayload) => (
                        <section
                          className="page-creation-overlay__top-player-section"
                          key={`${poolPayload.poolName}-${poolPayload.pageNumber || 1}`}
                        >
                          <div className="page-creation-overlay__top-player-section-header">
                            <h5>{poolPayload.previewLabel || poolPayload.poolName}</h5>
                            <span>{poolPayload.data?.standings_list?.data?.length || 0}</span>
                          </div>

                          <pre className="page-creation-overlay__json">{stringifyJson(poolPayload.data)}</pre>
                        </section>
                      ))}
                    </div>
                  </div>
                </div>
              ) : previewMode === "groups" ? (
                <>
                  <div className="page-creation-overlay__field-toolbar">
                    <div className="page-creation-overlay__field-actions">
                      <button
                        type="button"
                        className="page-creation-overlay__field-action"
                        onClick={() => setSelectedFieldPaths(groupColumns)}
                      >
                        Select all columns
                      </button>
                      <button
                        type="button"
                        className="page-creation-overlay__field-action"
                        onClick={() => setSelectedFieldPaths([])}
                      >
                        Clear all columns
                      </button>
                    </div>
                  </div>

                  <div className="page-creation-overlay__preview-block">
                    <div className="page-creation-overlay__panel-header">
                      <h4>Groups</h4>
                      <span>{filteredGroupsTable ? filteredGroupsTable.rows.length : 0}</span>
                    </div>

                    {filteredGroupsTable ? (
                      <div className="page-creation-overlay__table-wrap">
                        <table className="page-creation-overlay__table">
                          <thead>
                            <tr>
                              {filteredGroupsTable.columns.map((column) => (
                                <th key={column}>
                                  <label className="page-creation-overlay__table-header-toggle">
                                    <input
                                      type="checkbox"
                                      checked={selectedFieldPathSet.has(column)}
                                      onChange={() => {
                                        setSelectedFieldPaths((currentPaths) =>
                                          currentPaths.includes(column)
                                            ? currentPaths.filter((path) => path !== column)
                                            : [...currentPaths, column]
                                        );
                                      }}
                                    />
                                    <span>{column}</span>
                                  </label>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {filteredGroupsTable.rows.map((row, rowIndex) => (
                              <tr key={`group-row-${rowIndex + 1}`}>
                                {filteredGroupsTable.columns.map((column) => (
                                  <td key={`${column}-${rowIndex + 1}`}>{formatTableCellValue(row[column])}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <pre className="page-creation-overlay__json">
                        {stringifyJson(filteredSelectedData || selectedData || {})}
                      </pre>
                    )}
                  </div>
                </>
              ) : previewMode === "head-to-head" ? (
                <>
                  <div className="page-creation-overlay__field-toolbar">
                    <div className="page-creation-overlay__field-actions">
                      <button
                        type="button"
                        className="page-creation-overlay__field-action"
                        onClick={() =>
                          setSelectedFieldPaths([
                            ...headToHeadSummaryItems.map((item) => item.id),
                            ...headToHeadMatchItems.map((item) => item.id),
                            ...headToHeadFormItems.map((item) => item.id),
                          ])
                        }
                      >
                        Select all items
                      </button>
                      <button
                        type="button"
                        className="page-creation-overlay__field-action"
                        onClick={() => setSelectedFieldPaths([])}
                      >
                        Clear all items
                      </button>
                    </div>
                  </div>

                  <div className="page-creation-overlay__preview-block">
                    <div className="page-creation-overlay__panel-header">
                      <h4>Head To Head</h4>
                      <span>{selectedFieldPaths.length}</span>
                    </div>

                    <div className="page-creation-overlay__head-to-head-wrap">
                      <section className="page-creation-overlay__head-to-head-section">
                        <div className="page-creation-overlay__head-to-head-section-header">
                          <h5>Summary</h5>
                          <span>{filteredHeadToHeadSummaryItems.length}</span>
                        </div>

                        <div className="page-creation-overlay__head-to-head-summary-grid">
                          {headToHeadSummaryItems.map((item) => (
                            <label
                              className={`page-creation-overlay__head-to-head-summary-item ${
                                selectedFieldPathSet.has(item.id) ? "selected" : ""
                              }`}
                              key={item.id}
                            >
                              <input
                                type="checkbox"
                                checked={selectedFieldPathSet.has(item.id)}
                                onChange={() => {
                                  setSelectedFieldPaths((currentPaths) =>
                                    currentPaths.includes(item.id)
                                      ? currentPaths.filter((currentPath) => currentPath !== item.id)
                                      : [...currentPaths, item.id]
                                  );
                                }}
                              />
                              <span className="page-creation-overlay__head-to-head-summary-copy">
                                <small>{item.label}</small>
                                <strong>{item.value}</strong>
                              </span>
                            </label>
                          ))}
                        </div>
                      </section>

                      <section className="page-creation-overlay__head-to-head-section">
                        <div className="page-creation-overlay__head-to-head-section-header">
                          <h5>Last Meetings</h5>
                          <span>{filteredHeadToHeadMatchItems.length}</span>
                        </div>

                        <div className="page-creation-overlay__head-to-head-list">
                          {headToHeadMatchItems.map((item) => (
                            <label
                              className={`page-creation-overlay__head-to-head-match-item ${
                                selectedFieldPathSet.has(item.id) ? "selected" : ""
                              }`}
                              key={item.id}
                            >
                              <input
                                type="checkbox"
                                checked={selectedFieldPathSet.has(item.id)}
                                onChange={() => {
                                  setSelectedFieldPaths((currentPaths) =>
                                    currentPaths.includes(item.id)
                                      ? currentPaths.filter((currentPath) => currentPath !== item.id)
                                      : [...currentPaths, item.id]
                                  );
                                }}
                              />
                              <span className="page-creation-overlay__head-to-head-match-body">
                                <span className="page-creation-overlay__head-to-head-match-meta">
                                  <strong>{item.compName}</strong>
                                  <small>{[item.matchDate, item.venue].filter(Boolean).join(" | ")}</small>
                                </span>
                                <span className="page-creation-overlay__head-to-head-match-score">
                                  <strong>{`${item.homeTeamScore} - ${item.awayTeamScore}`}</strong>
                                  <small>{item.winner}</small>
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </section>

                      <section className="page-creation-overlay__head-to-head-section">
                        <div className="page-creation-overlay__head-to-head-section-header">
                          <h5>Recent Form</h5>
                          <span>{filteredHeadToHeadFormSections.reduce((total, section) => total + section.items.length, 0)}</span>
                        </div>

                        <div className="page-creation-overlay__head-to-head-form-grid">
                          {[homeTeamLabel, awayTeamLabel].map((label, index) => {
                            const teamKey = index === 0 ? "homeTeam" : "awayTeam";
                            const teamItems = headToHeadFormItems.filter((item) => item.teamKey === teamKey);
                            const selectedCount = teamItems.filter((item) => selectedFieldPathSet.has(item.id)).length;

                            return (
                              <section className="page-creation-overlay__head-to-head-form-section" key={teamKey}>
                                <div className="page-creation-overlay__head-to-head-section-header">
                                  <h5>{label}</h5>
                                  <span>{selectedCount}</span>
                                </div>

                                <div className="page-creation-overlay__head-to-head-form-list">
                                  {teamItems.map((item) => (
                                    <label
                                      className={`page-creation-overlay__head-to-head-form-item ${
                                        selectedFieldPathSet.has(item.id) ? "selected" : ""
                                      }`}
                                      key={item.id}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedFieldPathSet.has(item.id)}
                                        onChange={() => {
                                          setSelectedFieldPaths((currentPaths) =>
                                            currentPaths.includes(item.id)
                                              ? currentPaths.filter((currentPath) => currentPath !== item.id)
                                              : [...currentPaths, item.id]
                                          );
                                        }}
                                      />
                                      <span className="page-creation-overlay__head-to-head-form-body">
                                        <span
                                          className={`page-creation-overlay__head-to-head-form-result page-creation-overlay__head-to-head-form-result--${String(
                                            item.result || "-"
                                          ).toLowerCase()}`}
                                        >
                                          {item.result}
                                        </span>
                                        <span className="page-creation-overlay__head-to-head-form-copy">
                                          <strong>{item.oppositionTeamName}</strong>
                                          <small>{item.matchDate}</small>
                                        </span>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </section>
                            );
                          })}
                        </div>
                      </section>
                    </div>
                  </div>
                </>
              ) : previewMode === "top-player-scores" ? (
                <>
                  <div className="page-creation-overlay__field-toolbar">
                    <div className="page-creation-overlay__field-actions">
                      <button
                        type="button"
                        className="page-creation-overlay__field-action"
                        onClick={() => setSelectedFieldPaths(topPlayerItems.map((item) => item.id))}
                      >
                        Select all players
                      </button>
                      <button
                        type="button"
                        className="page-creation-overlay__field-action"
                        onClick={() => setSelectedFieldPaths([])}
                      >
                        Clear all players
                      </button>
                    </div>
                  </div>

                  <div className="page-creation-overlay__preview-block">
                    <div className="page-creation-overlay__panel-header">
                      <h4>Top Player Scores</h4>
                      <span>{filteredTopPlayerItems.length}</span>
                    </div>

                    <div className="page-creation-overlay__top-players-wrap">
                      <div className="page-creation-overlay__top-players-list">
                        {topPlayerSections.map((section) => (
                          <section className="page-creation-overlay__top-player-section" key={section.path}>
                            <div className="page-creation-overlay__top-player-section-header">
                              <h5>{section.title}</h5>
                              <span>{filteredTopPlayerSections.find((item) => item.path === section.path)?.items.length || 0}</span>
                            </div>

                            <div className="page-creation-overlay__top-player-section-list">
                              {section.items.map((item) => (
                                <label
                                  className={`page-creation-overlay__top-player-item ${
                                    selectedFieldPathSet.has(item.id) ? "selected" : ""
                                  }`}
                                  key={item.id}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedFieldPathSet.has(item.id)}
                                    onChange={() => {
                                      setSelectedFieldPaths((currentPaths) =>
                                        currentPaths.includes(item.id)
                                          ? currentPaths.filter((currentPath) => currentPath !== item.id)
                                          : [...currentPaths, item.id]
                                      );
                                    }}
                                  />
                                  <span className="page-creation-overlay__top-player-item-body">
                                    <span className="page-creation-overlay__top-player-rank">#{item.rank}</span>
                                    <span className="page-creation-overlay__top-player-copy">
                                      <strong>{item.playerName}</strong>
                                      <small>{item.statLabel}</small>
                                    </span>
                                    <span className="page-creation-overlay__top-player-score">{item.statScore}</span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : previewMode === "match-stats" ? (
                <>
                  <div className="page-creation-overlay__field-toolbar">
                    <div className="page-creation-overlay__field-actions">
                      <button
                        type="button"
                        className="page-creation-overlay__field-action"
                        onClick={() => setSelectedFieldPaths(resolvedMatchStatsDefaults.selectedPaths)}
                      >
                        Select default stats
                      </button>
                      <button
                        type="button"
                        className="page-creation-overlay__field-action"
                        onClick={() => setSelectedFieldPaths([])}
                      >
                        Clear all stats
                      </button>
                    </div>
                  </div>

                  {statsPageOptions.length ? (
                    <label className="page-creation-overlay__field-select">
                      <span>Default stats page</span>
                      <select
                        value={selectedStatsPageKey}
                        onChange={(event) => setSelectedStatsPageKey(event.target.value)}
                      >
                        {statsPageOptions.map((pageKey) => (
                          <option key={pageKey} value={pageKey}>
                            {humanizeLabel(pageKey)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  {loadingStatsPageDefaults ? (
                    <p className="page-creation-overlay__helper-text">Loading default stats pages...</p>
                  ) : null}
                  {statsPageDefaultsError ? (
                    <p className="page-creation-overlay__helper-text page-creation-overlay__helper-text--error">
                      {statsPageDefaultsError}
                    </p>
                  ) : null}

                  <label className="page-creation-overlay__field-select">
                    <span>Search stats</span>
                    <input
                      type="search"
                      className="search-input"
                      value={matchStatsSearchTerm}
                      onChange={(event) => setMatchStatsSearchTerm(event.target.value)}
                      placeholder="Search by stat description"
                    />
                  </label>

                  <div className="page-creation-overlay__preview-block">
                    <div className="page-creation-overlay__panel-header">
                      <h4>Team Stats List</h4>
                      <span>{`${filteredTeamStatsList.length}/${matchStatsSelectionLimit}`}</span>
                    </div>

                    <div className="page-creation-overlay__stats-legend">
                      <span>{homeTeamLabel}</span>
                      <span>Stat</span>
                      <span>{awayTeamLabel}</span>
                    </div>

                    <div className="page-creation-overlay__stats-list-wrap">
                      <div className="page-creation-overlay__stats-list">
                        {visibleMatchStatItems.map((item) => {
                          const isSelected = selectedFieldPathSet.has(item.path);
                          const hasReachedLimit = selectedFieldPaths.length >= matchStatsSelectionLimit;
                          const suffixValue = selectedMatchStatsSuffixByPath[item.path] ?? item.defaultSuffix;

                          return (
                            <label
                              className={`page-creation-overlay__stats-item ${
                                isSelected ? "selected" : ""
                              }`}
                              key={item.path}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={!isSelected && hasReachedLimit}
                                onChange={() => {
                                  setSelectedFieldPaths((currentPaths) =>
                                    currentPaths.includes(item.path)
                                      ? currentPaths.filter((currentPath) => currentPath !== item.path)
                                      : [...currentPaths, item.path].slice(0, matchStatsSelectionLimit)
                                  );
                                }}
                              />
                              <span className="page-creation-overlay__stats-item-text">
                                <span className="page-creation-overlay__stats-value page-creation-overlay__stats-value--home">
                                  <small>{homeTeamLabel}</small>
                                  <strong>{item.homeValue}</strong>
                                </span>
                                <span className="page-creation-overlay__stats-description">
                                  <small>Stat</small>
                                  <strong>{item.label}</strong>
                                  <em>{`[${item.homeValue}, ${item.label}, ${item.awayValue}]`}</em>
                                  <select
                                    value={suffixValue}
                                    onChange={(event) => {
                                      const nextValue = event.target.value;
                                      setSelectedMatchStatsSuffixByPath((currentSuffixByPath) => ({
                                        ...currentSuffixByPath,
                                        [item.path]: nextValue,
                                      }));
                                    }}
                                  >
                                    <option value="">No suffix</option>
                                    <option value="%">%</option>
                                    <option value="*">*</option>
                                  </select>
                                </span>
                                <span className="page-creation-overlay__stats-value page-creation-overlay__stats-value--away">
                                  <small>{awayTeamLabel}</small>
                                  <strong>{item.awayValue}</strong>
                                </span>
                              </span>
                            </label>
                          );
                        })}
                        {!visibleMatchStatItems.length ? (
                          <p className="page-creation-overlay__helper-text">
                            No stats matched that description.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </>
              ) : previewMode === "player-stats" ? (
                <>
                  <div className="page-creation-overlay__field-toolbar">
                    <div className="page-creation-overlay__field-actions">
                      <button
                        type="button"
                        className="page-creation-overlay__field-action"
                        onClick={() => setSelectedFieldPaths(resolvedPlayerStatsDefaults.selectedPaths)}
                      >
                        Select default stats
                      </button>
                      <button
                        type="button"
                        className="page-creation-overlay__field-action"
                        onClick={() => setSelectedFieldPaths([])}
                      >
                        Clear all stats
                      </button>
                    </div>
                  </div>

                  <div className="page-creation-overlay__team-sheet-list">
                    <label className="page-creation-overlay__selector">
                      <span>Team source</span>
                      <select
                        value={selectedPlayerStatsTeamKey}
                        onChange={(event) => setSelectedPlayerStatsTeamKey(event.target.value)}
                      >
                        <option value="">Select team</option>
                        {playerStatsTeamOptions.map((teamOption) => (
                          <option key={teamOption.teamKey} value={teamOption.teamKey}>
                            {teamOption.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="page-creation-overlay__selector">
                      <span>Player</span>
                      <select
                        value={selectedPlayerStatsPlayerId}
                        onChange={(event) => setSelectedPlayerStatsPlayerId(event.target.value)}
                      >
                        <option value="">Select player</option>
                        {(selectedPlayerStatsTeam?.players || []).map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.primary}
                            {player.badge ? ` | ${player.badge}` : ""}
                            {player.secondary ? ` | ${player.secondary}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {statsPageOptions.length ? (
                    <label className="page-creation-overlay__field-select">
                      <span>Default stats page</span>
                      <select
                        value={selectedStatsPageKey}
                        onChange={(event) => setSelectedStatsPageKey(event.target.value)}
                      >
                        {statsPageOptions.map((pageKey) => (
                          <option key={pageKey} value={pageKey}>
                            {humanizeLabel(pageKey)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  {loadingStatsPageDefaults ? (
                    <p className="page-creation-overlay__helper-text">Loading default stats pages...</p>
                  ) : null}
                  {statsPageDefaultsError ? (
                    <p className="page-creation-overlay__helper-text page-creation-overlay__helper-text--error">
                      {statsPageDefaultsError}
                    </p>
                  ) : null}

                  <label className="page-creation-overlay__field-select">
                    <span>Search stats</span>
                    <input
                      type="search"
                      className="search-input"
                      value={playerStatsSearchTerm}
                      onChange={(event) => setPlayerStatsSearchTerm(event.target.value)}
                      placeholder="Search by stat description"
                    />
                  </label>

                  <div className="page-creation-overlay__preview-block">
                    <div className="page-creation-overlay__panel-header">
                      <h4>Player Stats List</h4>
                      <span>{`${filteredTeamStatsList.length}/${matchStatsSelectionLimit}`}</span>
                    </div>

                    <div className="page-creation-overlay__stats-list-wrap">
                      <div className="page-creation-overlay__stats-list">
                        {visiblePlayerStatItems.map((item) => {
                          const isSelected = selectedFieldPathSet.has(item.path);
                          const hasReachedLimit = selectedFieldPaths.length >= matchStatsSelectionLimit;
                          const suffixValue = selectedMatchStatsSuffixByPath[item.path] ?? item.defaultSuffix;

                          return (
                            <label
                              className={`page-creation-overlay__stats-item ${
                                isSelected ? "selected" : ""
                              }`}
                              key={item.path}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={!isSelected && hasReachedLimit}
                                onChange={() => {
                                  setSelectedFieldPaths((currentPaths) =>
                                    currentPaths.includes(item.path)
                                      ? currentPaths.filter((currentPath) => currentPath !== item.path)
                                      : [...currentPaths, item.path].slice(0, matchStatsSelectionLimit)
                                  );
                                }}
                              />
                              <span className="page-creation-overlay__stats-item-text">
                                <span className="page-creation-overlay__stats-description">
                                  <small>Stat</small>
                                  <strong>{item.label}</strong>
                                  <em>{`[${item.value}, ${item.label}]`}</em>
                                  <select
                                    value={suffixValue}
                                    onChange={(event) => {
                                      const nextValue = event.target.value;
                                      setSelectedMatchStatsSuffixByPath((currentSuffixByPath) => ({
                                        ...currentSuffixByPath,
                                        [item.path]: nextValue,
                                      }));
                                    }}
                                  >
                                    <option value="">No suffix</option>
                                    <option value="%">%</option>
                                    <option value="*">*</option>
                                  </select>
                                </span>
                                <span className="page-creation-overlay__stats-value page-creation-overlay__stats-value--home">
                                  <small>{selectedPlayerStatsPlayer?.primary || "Player"}</small>
                                  <strong>{item.value}</strong>
                                </span>
                              </span>
                            </label>
                          );
                        })}
                        {!visiblePlayerStatItems.length ? (
                          <p className="page-creation-overlay__helper-text">
                            No stats matched that description.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </>
              ) : previewMode === "team-sheets" ? (
                <>
                  <div className="page-creation-overlay__preview-block">
                    <div className="page-creation-overlay__panel-header">
                      <h4>Team Sheet Selection</h4>
                      <span>{teamSheetSelectionCount}</span>
                    </div>

                    <div className="page-creation-overlay__team-sheet-wrap">
                      <div className="page-creation-overlay__team-sheet-list">
                        {isTeamSheetReplacementMode ? (
                          <>
                            <p className="page-creation-overlay__helper">
                              This template uses both teams&apos; substitutes. Replacement rows are populated automatically from players with shirt numbers 16 and above.
                            </p>

                            <section className="page-creation-overlay__team-sheet-section">
                              <div className="page-creation-overlay__team-sheet-section-header">
                                <h5>Graphic Data</h5>
                                <span>
                                  {(filteredSelectedData?.home_team_replacements?.data?.length || 0) +
                                    (filteredSelectedData?.away_team_replacements?.data?.length || 0)}
                                </span>
                              </div>
                              <pre className="page-creation-overlay__json">{stringifyJson(filteredSelectedData || {})}</pre>
                            </section>
                          </>
                        ) : (
                          <>
                        <label className="page-creation-overlay__selector">
                          <span>Team source</span>
                          <select
                            value={selectedTeamSheetTeamKey}
                            onChange={(event) => setSelectedTeamSheetTeamKey(event.target.value)}
                          >
                            <option value="">Select team</option>
                            {teamSheetTeamOptions.map((teamOption) => (
                              <option key={teamOption.teamKey} value={teamOption.teamKey}>
                                {teamOption.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        {teamSheetPresetFields ? (
                          <p className="page-creation-overlay__helper">
                            Team Sheet fields from the selected data type were used to prefill any matching selections.
                          </p>
                        ) : null}

                        {!hasEnoughTeamSheetPlayers && selectedTeamSheetTeam ? (
                          <p className="page-creation-overlay__helper">
                            {`${selectedTeamSheetTeam.label} has ${selectedTeamSheetTeam.players.length} players available, but the graphic needs ${teamSheetPlayerLimit}.`}
                          </p>
                        ) : null}

                        <section className="page-creation-overlay__team-sheet-section">
                          <div className="page-creation-overlay__team-sheet-section-header">
                            <h5>Players</h5>
                            <span>{`${selectedTeamSheetPlayerIds.length}/${teamSheetPlayerLimit}`}</span>
                          </div>

                          <div className="page-creation-overlay__team-sheet-grid">
                            {(selectedTeamSheetTeam?.players || []).map((item) => {
                              const isSelected = selectedTeamSheetPlayerIds.includes(item.id);
                              const hasReachedLimit = selectedTeamSheetPlayerIds.length >= teamSheetPlayerLimit;
                              const imageStatus = teamSheetPlayerImageStatusById[item.id] || "unknown";

                              return (
                                <label
                                  className={`page-creation-overlay__team-sheet-item ${
                                    isSelected ? "selected" : ""
                                  } page-creation-overlay__team-sheet-item--player`}
                                  key={item.id}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    disabled={!isSelected && hasReachedLimit}
                                    onChange={() => {
                                      setSelectedTeamSheetPlayerIds((currentIds) =>
                                        currentIds.includes(item.id)
                                          ? currentIds.filter((playerId) => playerId !== item.id)
                                          : [...currentIds, item.id].slice(0, teamSheetPlayerLimit)
                                      );
                                    }}
                                  />
                                  <span className="page-creation-overlay__team-sheet-item-body">
                                    <span className="page-creation-overlay__team-sheet-item-badge">{item.badge}</span>
                                    <span className="page-creation-overlay__team-sheet-item-copy">
                                      <strong>
                                        <span>{item.primary}</span>
                                        {imageStatus !== "unknown" ? (
                                          <span
                                            className={`page-creation-overlay__team-sheet-image-status page-creation-overlay__team-sheet-image-status--${imageStatus}`}
                                            aria-label={
                                              imageStatus === "found" ? "Player image found" : "Player image not found"
                                            }
                                            title={
                                              imageStatus === "found" ? "Player image found" : "Player image not found"
                                            }
                                          />
                                        ) : null}
                                      </strong>
                                      <small>{item.secondary || selectedTeamSheetTeam?.label}</small>
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </section>

                        {teamSheetManifestSections?.coach?.itemKeys?.length ? (
                          <label className="page-creation-overlay__selector">
                            <span>Coach</span>
                            <select
                              value={selectedTeamSheetCoachId}
                              onChange={(event) => setSelectedTeamSheetCoachId(event.target.value)}
                            >
                              <option value="">Select coach</option>
                              {(selectedTeamSheetTeam?.coaches || []).map((coach) => (
                                <option key={coach.id} value={coach.id}>
                                  {coach.primary}
                                  {coach.secondary ? ` | ${coach.secondary}` : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}

                        {teamSheetManifestSections?.headCoach?.itemKeys?.length ? (
                          <label className="page-creation-overlay__selector">
                            <span>Head coach</span>
                            <select
                              value={selectedTeamSheetHeadCoachId}
                              onChange={(event) => setSelectedTeamSheetHeadCoachId(event.target.value)}
                            >
                              <option value="">Select head coach</option>
                              {(selectedTeamSheetTeam?.coaches || []).map((coach) => (
                                <option key={coach.id} value={coach.id}>
                                  {coach.primary}
                                  {coach.secondary ? ` | ${coach.secondary}` : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}

                        <label className="page-creation-overlay__selector">
                          <span>Team name</span>
                          <select
                            value={selectedTeamSheetName}
                            onChange={(event) => setSelectedTeamSheetName(event.target.value)}
                          >
                            <option value="">Select team name</option>
                            {(selectedTeamSheetTeam?.teamNameOptions || []).map((teamNameOption) => (
                              <option key={teamNameOption.value} value={teamNameOption.value}>
                                {teamNameOption.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <section className="page-creation-overlay__team-sheet-section">
                          <div className="page-creation-overlay__team-sheet-section-header">
                            <h5>Graphic Data</h5>
                            <span>{filteredSelectedData?.players_list?.data?.length || 0}</span>
                          </div>
                          <pre className="page-creation-overlay__json">{stringifyJson(filteredSelectedData || {})}</pre>
                        </section>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <pre className="page-creation-overlay__json">{stringifyJson(selectedData || {})}</pre>
              )}
            </section>

            <section className="page-creation-overlay__panel page-creation-overlay__panel--templates">
              <div className="page-creation-overlay__panel-header">
                <h4>{selectedShow ? `Templates in ${selectedShow.name}` : "Shows"}</h4>
                <span>{selectedShow ? templates.length : shows.length}</span>
              </div>

              <div className="page-creation-overlay__templates">
                <div className="page-creation-overlay__template-list">
                  {!selectedShow ? (
                    shows.length ? (
                      shows.map((show) => (
                        <button
                          type="button"
                          key={show.id}
                          className="page-creation-overlay__template-item"
                          onClick={() => setSelectedShowId(show.id)}
                        >
                          {show.name}
                        </button>
                      ))
                    ) : (
                      <p className="empty-state">No shows available.</p>
                    )
                  ) : loadingTemplates ? (
                    <>
                      <button
                        type="button"
                        className="page-creation-overlay__template-back"
                        onClick={() => {
                          setSelectedShowId("");
                          setTemplates([]);
                          setSelectedTemplateId("");
                        }}
                      >
                        Back to shows
                      </button>
                      <p className="loading">Loading templates...</p>
                    </>
                  ) : templates.length ? (
                    <>
                      <button
                        type="button"
                        className="page-creation-overlay__template-back"
                        onClick={() => {
                          setSelectedShowId("");
                          setTemplates([]);
                          setSelectedTemplateId("");
                        }}
                      >
                        Back to shows
                      </button>
                      {templates.map((template) => (
                      <button
                        type="button"
                        key={template.id}
                        className={`page-creation-overlay__template-item ${
                          template.id === selectedTemplateId ? "selected" : ""
                        }`}
                        onClick={() => setSelectedTemplateId(template.id)}
                      >
                        {template.name}
                      </button>
                      ))}
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="page-creation-overlay__template-back"
                        onClick={() => {
                          setSelectedShowId("");
                          setTemplates([]);
                        }}
                      >
                        Back to shows
                      </button>
                      <p className="empty-state">No templates available for this show.</p>
                    </>
                  )}
                </div>

                <div className="page-creation-overlay__template-preview">
                  {selectedTemplate && selectedManifest ? (
                    <>
                      <h5>{selectedTemplate.name}</h5>
                      <pre className="page-creation-overlay__json">
                        {stringifyJson(selectedManifest)}
                      </pre>
                    </>
                  ) : loadingManifest ? (
                    <p className="loading">Loading graphic manifest...</p>
                  ) : preparingTemplate ? (
                    <p className="loading">Preparing template...</p>
                  ) : !selectedShow ? (
                    <p className="empty-state">Select a show to browse its templates.</p>
                  ) : (
                    <p className="empty-state">Select a template to map the data into the graphic.</p>
                  )}
                </div>
              </div>
            </section>
          </div>
        ) : null}

        <div className="page-creation-overlay__actions">
          {submitStatus ? (
            <p
              className={`page-creation-overlay__submit-status page-creation-overlay__submit-status--${submitStatus.kind}`}
            >
              {submitStatus.message}
            </p>
          ) : null}
          <button type="button" className="source-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="action-button page-creation-overlay__confirm"
            disabled={
              loading ||
              preparingTemplate ||
              submitting ||
              loadingTemplates ||
              ((previewMode === "groups" ||
                previewMode === "head-to-head" ||
                previewMode === "match-stats" ||
                previewMode === "player-stats" ||
                previewMode === "top-player-scores") &&
                !selectedFieldPaths.length) ||
              (previewMode === "standings" && !standingsPoolPayloads.length) ||
              (previewMode === "team-sheets" && !hasCompleteTeamSheetSelection) ||
              !selectedShow ||
              !preparedTemplate ||
              !filteredSelectedData ||
              (requiresCoverageSelection && !selectedCoverage) ||
              (requiresRoundSelection && !selectedRound) ||
              (requiresStatSelection && !selectedStat)
            }
            onClick={onCreatePage}
          >
            {submitting ? "Creating..." : "Create Page"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
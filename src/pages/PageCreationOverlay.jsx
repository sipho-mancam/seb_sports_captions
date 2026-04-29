import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { useAppFlow } from "../context/AppFlowContext";
import {
  buildFieldValuesFromTemplate,
  createGraphicPage,
  getGraphicManifest,
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

function formatStatDescription(path) {
  return path
    .split(".")
    .map((segment) => humanizeLabel(segment))
    .join(" | ");
}

function formatListItemValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
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

function getPlayerDisplayName(player) {
  return player?.knownName || player?.name || [player?.firstName, player?.lastName].filter(Boolean).join(" ") || "Player";
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

function buildTeamSheetSelectableItems(selectedData) {
  const items = [];

  const addPlayerGroup = (teamKey, teamData, sectionKey, sectionTitle, predicate) => {
    const teamLabel = getTeamLabel(teamData, teamKey === "homeTeam" ? "Home" : "Away");
    const players = sortPlayersByShirtNumber((teamData?.players || []).filter(predicate));

    players.forEach((player, index) => {
      const shirtNumber = getPlayerShirtNumber(player);
      const positionName = player?.position?.name ? humanizeLabel(player.position.name) : null;
      const tags = [player?.captain === "true" ? "Captain" : null, positionName].filter(Boolean);

      items.push({
        id: getTeamSheetSelectionId("players", teamKey, player, index),
        type: sectionKey,
        section: `${teamLabel} ${sectionTitle}`,
        teamKey,
        teamLabel,
        primary: getPlayerDisplayName(player),
        secondary: tags.join(" | "),
        badge: shirtNumber !== null && shirtNumber !== undefined ? String(shirtNumber) : "-",
      });
    });
  };

  addPlayerGroup("homeTeam", selectedData?.homeTeam, "players", "Players", (player) => !isSubstitutePlayer(player));
  addPlayerGroup("homeTeam", selectedData?.homeTeam, "subs", "Subs", (player) => isSubstitutePlayer(player));
  addPlayerGroup("awayTeam", selectedData?.awayTeam, "players", "Players", (player) => !isSubstitutePlayer(player));
  addPlayerGroup("awayTeam", selectedData?.awayTeam, "subs", "Subs", (player) => isSubstitutePlayer(player));

  [
    ["homeTeam", selectedData?.homeTeam],
    ["awayTeam", selectedData?.awayTeam],
  ].forEach(([teamKey, teamData]) => {
    const teamLabel = getTeamLabel(teamData, teamKey === "homeTeam" ? "Home" : "Away");

    (teamData?.coaches || []).forEach((coach, index) => {
      items.push({
        id: getTeamSheetSelectionId("coaches", teamKey, coach, index),
        type: "coaches",
        section: `${teamLabel} Coaches`,
        teamKey,
        teamLabel,
        primary: coach?.knownName || coach?.name || "Coach",
        secondary: coach?.role?.name ? humanizeLabel(coach.role.name) : "Coach",
        badge: "C",
      });
    });
  });

  (selectedData?.officials || []).forEach((official, index) => {
    items.push({
      id: getTeamSheetSelectionId("officials", null, official, index),
      type: "officials",
      section: "Officials",
      teamKey: null,
      teamLabel: "Match",
      primary: official?.name || "Official",
      secondary: official?.role ? humanizeLabel(official.role) : "Official",
      badge: "O",
    });
  });

  return items;
}

function buildFilteredTeamSheetData(selectedData, selectedItemIds) {
  const selectedIdSet = new Set(selectedItemIds);

  const filterBySelection = (scope, teamKey, items = []) =>
    items.filter((item, index) => selectedIdSet.has(getTeamSheetSelectionId(scope, teamKey, item, index)));

  return {
    competition: selectedData?.competition ?? null,
    season: selectedData?.season ?? null,
    venue: selectedData?.venue ?? null,
    homeTeam: {
      team: selectedData?.homeTeam?.team ?? null,
      players: filterBySelection("players", "homeTeam", selectedData?.homeTeam?.players || []),
      coaches: filterBySelection("coaches", "homeTeam", selectedData?.homeTeam?.coaches || []),
    },
    awayTeam: {
      team: selectedData?.awayTeam?.team ?? null,
      players: filterBySelection("players", "awayTeam", selectedData?.awayTeam?.players || []),
      coaches: filterBySelection("coaches", "awayTeam", selectedData?.awayTeam?.coaches || []),
    },
    officials: filterBySelection("officials", null, selectedData?.officials || []),
  };
}

function buildFilteredSelectedData(selectedData, selectedFieldPaths, options = {}) {
  if (!selectedData) {
    return null;
  }

  if (options.previewMode === "top-player-scores") {
    return buildFilteredTopPlayerScoresData(selectedData, selectedFieldPaths, options.topPlayerItems || []);
  }

  if (isMatchStatsPayload(selectedData)) {
    return {
      competition: selectedData.competition ?? null,
      season: selectedData.season ?? null,
      round: selectedData.round ?? null,
      venue: selectedData.venue ?? null,
      homeTeam: {
        team: selectedData.homeTeam?.team ?? null,
        score: selectedData.homeTeam?.score ?? null,
      },
      awayTeam: {
        team: selectedData.awayTeam?.team ?? null,
        score: selectedData.awayTeam?.score ?? null,
      },
      teamStatsList: buildTeamStatsList(selectedData, selectedFieldPaths),
    };
  }

  if (isTeamSheetsPayload(selectedData)) {
    return buildFilteredTeamSheetData(selectedData, selectedFieldPaths);
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
  const { state } = useAppFlow();
  const [selectedData, setSelectedData] = useState(null);
  const [selectedFieldPaths, setSelectedFieldPaths] = useState([]);
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
  const [selectedStat, setSelectedStat] = useState("");
  const [selectedCoverage, setSelectedCoverage] = useState("");
  const [selectedRound, setSelectedRound] = useState("");

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

  const teamSheetItems = useMemo(() => {
    if (!isTeamSheetsPayload(selectedData) || isMatchStatsPayload(selectedData)) {
      return [];
    }

    return buildTeamSheetSelectableItems(selectedData);
  }, [selectedData]);

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
          path: item.sectionPath,
          title: item.sectionLabel,
          items: [],
        });
      }

      sections.get(item.sectionPath).items.push(item);
    });

    return Array.from(sections.values());
  }, [topPlayerItems]);

  const teamSheetSections = useMemo(() => {
    const sections = new Map();

    teamSheetItems.forEach((item) => {
      if (!sections.has(item.section)) {
        sections.set(item.section, []);
      }

      sections.get(item.section).push(item);
    });

    return Array.from(sections.entries()).map(([title, items]) => ({ title, items }));
  }, [teamSheetItems]);

  const teamStatPaths = useMemo(() => {
    if (!isMatchStatsPayload(selectedData)) {
      return [];
    }

    return collectTeamStatPaths(selectedData?.homeTeam?.teamStats, selectedData?.awayTeam?.teamStats).sort(
      (left, right) => left.localeCompare(right)
    );
  }, [selectedData]);

  const previewMode = useMemo(() => {
    if (groupColumns.length) {
      return "groups";
    }

    if (topPlayerItems.length) {
      return "top-player-scores";
    }

    if (teamStatPaths.length) {
      return "match-stats";
    }

    if (teamSheetItems.length) {
      return "team-sheets";
    }

    return "json";
  }, [groupColumns, teamSheetItems.length, teamStatPaths, topPlayerItems.length]);

  useEffect(() => {
    if (previewMode === "groups") {
      setSelectedFieldPaths(groupColumns);
      return;
    }

    if (previewMode === "match-stats") {
      setSelectedFieldPaths(teamStatPaths);
      return;
    }

    if (previewMode === "top-player-scores") {
      setSelectedFieldPaths(topPlayerItems.map((item) => item.id));
      return;
    }

    if (previewMode === "team-sheets") {
      setSelectedFieldPaths(teamSheetItems.map((item) => item.id));
      return;
    }

    setSelectedFieldPaths([]);
  }, [groupColumns, previewMode, teamSheetItems, teamStatPaths, topPlayerItems]);

  const selectedFieldPathSet = useMemo(() => new Set(selectedFieldPaths), [selectedFieldPaths]);

  const filteredSelectedData = useMemo(
    () =>
      buildFilteredSelectedData(selectedData, selectedFieldPaths, {
        previewMode,
        topPlayerItems,
      }),
    [previewMode, selectedData, selectedFieldPaths, topPlayerItems]
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
    if (previewMode !== "match-stats") {
      return [];
    }

    return Array.isArray(filteredSelectedData?.teamStatsList) ? filteredSelectedData.teamStatsList : [];
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

  const filteredTeamSheetSections = useMemo(() => {
    if (previewMode !== "team-sheets") {
      return [];
    }

    const selectedIdSet = new Set(selectedFieldPaths);

    return teamSheetSections
      .map((section) => ({
        title: section.title,
        items: section.items.filter((item) => selectedIdSet.has(item.id)),
      }))
      .filter((section) => section.items.length);
  }, [previewMode, selectedFieldPaths, teamSheetSections]);

  const homeTeamLabel = useMemo(
    () => selectedData?.homeTeam?.team?.shortName || selectedData?.homeTeam?.team?.name || "Home",
    [selectedData]
  );

  const awayTeamLabel = useMemo(
    () => selectedData?.awayTeam?.team?.shortName || selectedData?.awayTeam?.team?.name || "Away",
    [selectedData]
  );

  const titleText = useMemo(() => {
    if (previewMode === "top-player-scores") {
      return selectedDataType?.dataType || "Top 10 Players";
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
  }, [filteredSelectedData, previewMode, selectedData, selectedDataType?.dataType]);

  const subtitleText = useMemo(() => {
    if (previewMode === "top-player-scores") {
      const competitionName = selectedData?.competition?.name;
      const seasonName = selectedData?.season?.name;
      const statName = selectedDataType?.type;
      return [competitionName, seasonName, statName].filter(Boolean).join(" | ");
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
  }, [filteredSelectedData, previewMode, selectedData, selectedDataType?.type]);

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
      } catch (loadError) {
        if (mounted) {
          setSelectedData(null);
          setShows([]);
          setTemplates([]);
          setSelectedShowId("");
          setSelectedTemplateId("");
          setSelectedManifest(null);
          setError(loadError.message || "Failed to load page creation data.");
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
        return;
      }

      setLoadingTemplates(true);
      setError("");

      try {
        const templateList = await getGraphicTemplates(selectedShow.raw);
        if (!mounted) {
          return;
        }

        setTemplates(templateList);
        setSelectedTemplateId("");
        setSelectedManifest(null);
      } catch (loadError) {
        if (mounted) {
          setTemplates([]);
          setSelectedTemplateId("");
          setSelectedManifest(null);
          setError(loadError.message || "Failed to load templates.");
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
          setSelectedManifest(null);
          setError(loadError.message || "Failed to load graphic manifest.");
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
          setPreparedTemplate(null);
          setError(loadError.message || "Failed to prepare template.");
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

      const fieldValues = buildFieldValuesFromTemplate(preparedTemplate.mapping, filteredSelectedData);
      const createdPage = await createGraphicPage({ preparedTemplate, fieldValues });

      await onConfirm({
        createdPage,
        selectedCoverage,
        selectedData: filteredSelectedData,
        selectedFieldPaths,
        selectedRound,
        selectedStat,
        template: {
          ...selectedTemplate,
          mapping: preparedTemplate.mapping,
          templateName: preparedTemplate.templateName,
        },
        fieldValues,
      });
    } catch (submitError) {
      setError(submitError.message || "Failed to create page.");
    } finally {
      setSubmitting(false);
    }
  };

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="modal-overlay page-creation-overlay" onClick={onClose}>
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
                <span>{selectedFieldPaths.length}</span>
              </div>

              {previewMode === "groups" ? (
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
                        onClick={() => setSelectedFieldPaths(teamStatPaths)}
                      >
                        Select all stats
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

                  <div className="page-creation-overlay__preview-block">
                    <div className="page-creation-overlay__panel-header">
                      <h4>Team Stats List</h4>
                      <span>{filteredTeamStatsList.length}</span>
                    </div>

                    <div className="page-creation-overlay__stats-legend">
                      <span>{homeTeamLabel}</span>
                      <span>Stat</span>
                      <span>{awayTeamLabel}</span>
                    </div>

                    <div className="page-creation-overlay__stats-list-wrap">
                      <div className="page-creation-overlay__stats-list">
                        {teamStatPaths.map((path) => {
                          const item = [
                            formatListItemValue(getNestedValue(selectedData?.homeTeam?.teamStats || {}, path)),
                            formatStatDescription(path),
                            formatListItemValue(getNestedValue(selectedData?.awayTeam?.teamStats || {}, path)),
                          ];

                          return (
                            <label
                              className={`page-creation-overlay__stats-item ${
                                selectedFieldPathSet.has(path) ? "selected" : ""
                              }`}
                              key={path}
                            >
                              <input
                                type="checkbox"
                                checked={selectedFieldPathSet.has(path)}
                                onChange={() => {
                                  setSelectedFieldPaths((currentPaths) =>
                                    currentPaths.includes(path)
                                      ? currentPaths.filter((currentPath) => currentPath !== path)
                                      : [...currentPaths, path]
                                  );
                                }}
                              />
                              <span className="page-creation-overlay__stats-item-text">
                                <span className="page-creation-overlay__stats-value page-creation-overlay__stats-value--home">
                                  <small>{homeTeamLabel}</small>
                                  <strong>{item[0]}</strong>
                                </span>
                                <span className="page-creation-overlay__stats-description">
                                  <small>Stat</small>
                                  <strong>{item[1]}</strong>
                                  <em>{`[${item[0]}, ${item[1]}, ${item[2]}]`}</em>
                                </span>
                                <span className="page-creation-overlay__stats-value page-creation-overlay__stats-value--away">
                                  <small>{awayTeamLabel}</small>
                                  <strong>{item[2]}</strong>
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              ) : previewMode === "team-sheets" ? (
                <>
                  <div className="page-creation-overlay__field-toolbar">
                    <div className="page-creation-overlay__field-actions">
                      <button
                        type="button"
                        className="page-creation-overlay__field-action"
                        onClick={() => setSelectedFieldPaths(teamSheetItems.map((item) => item.id))}
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
                      <h4>Team Sheet Items</h4>
                      <span>{selectedFieldPaths.length}</span>
                    </div>

                    <div className="page-creation-overlay__team-sheet-wrap">
                      <div className="page-creation-overlay__team-sheet-list">
                        {teamSheetSections.map((section) => (
                          <section className="page-creation-overlay__team-sheet-section" key={section.title}>
                            <div className="page-creation-overlay__team-sheet-section-header">
                              <h5>{section.title}</h5>
                              <span>{section.items.filter((item) => selectedFieldPathSet.has(item.id)).length}</span>
                            </div>

                            <div className="page-creation-overlay__team-sheet-grid">
                              {section.items.map((item) => (
                                <label
                                  className={`page-creation-overlay__team-sheet-item ${
                                    selectedFieldPathSet.has(item.id) ? "selected" : ""
                                  } ${item.type === "players" || item.type === "subs" ? "page-creation-overlay__team-sheet-item--player" : ""}`}
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
                                  <span className="page-creation-overlay__team-sheet-item-body">
                                    <span className="page-creation-overlay__team-sheet-item-badge">{item.badge}</span>
                                    <span className="page-creation-overlay__team-sheet-item-copy">
                                      <strong>{item.primary}</strong>
                                      <small>{item.secondary || item.teamLabel}</small>
                                    </span>
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
                previewMode === "match-stats" ||
                previewMode === "team-sheets" ||
                previewMode === "top-player-scores") &&
                !selectedFieldPaths.length) ||
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
export class MatchStatsDataTypeWorker {
  constructor(utils) {
    this.utils = utils;
  }

  collectTeamStatPaths(homeStats, awayStats, parentPath = "", paths = new Set()) {
    const homeRecord = this.utils.isRecord(homeStats) ? homeStats : null;
    const awayRecord = this.utils.isRecord(awayStats) ? awayStats : null;
    const keys = new Set([
      ...Object.keys(homeRecord || {}),
      ...Object.keys(awayRecord || {}),
    ]);

    keys.forEach((key) => {
      const nextPath = parentPath ? `${parentPath}.${key}` : key;
      const homeValue = homeRecord?.[key];
      const awayValue = awayRecord?.[key];

      if (this.utils.isRecord(homeValue) || this.utils.isRecord(awayValue)) {
        this.collectTeamStatPaths(homeValue, awayValue, nextPath, paths);
        return;
      }

      if (homeValue !== undefined || awayValue !== undefined) {
        paths.add(nextPath);
      }
    });

    return Array.from(paths);
  }

  buildTeamStatsList(selectedData, selectedStatPaths) {
    const homeStats = selectedData?.homeTeam?.teamStats || {};
    const awayStats = selectedData?.awayTeam?.teamStats || {};

    return selectedStatPaths.map((path) => [
      this.utils.formatListItemValue(this.utils.getNestedValue(homeStats, path)),
      this.utils.formatStatDescription(path),
      this.utils.formatListItemValue(this.utils.getNestedValue(awayStats, path)),
    ]);
  }

  isPayload(selectedData) {
    return Boolean(selectedData?.homeTeam?.teamStats || selectedData?.awayTeam?.teamStats);
  }

  getDefaultSuffix() {
    return "";
  }

  formatValue(value) {
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

  getSelectableItems(selectedData, selectedStatPaths) {
    const homeStats = selectedData?.homeTeam?.teamStats || {};
    const awayStats = selectedData?.awayTeam?.teamStats || {};

    return selectedStatPaths.map((path) => ({
      awayValue: this.formatValue(this.utils.getNestedValue(awayStats, path)),
      defaultSuffix: this.getDefaultSuffix(path),
      homeValue: this.formatValue(this.utils.getNestedValue(homeStats, path)),
      id: path,
      label: this.utils.formatStatDescription(path),
      path,
    }));
  }

  buildCaptainPhotoData(selectedData, itemKeys) {
    const homeTeam = selectedData?.homeTeam?.team || {};
    const awayTeam = selectedData?.awayTeam?.team || {};
    const homePlayer = this.utils.findTeamCaptainPlayer(selectedData?.homeTeam?.players);
    const awayPlayer = this.utils.findTeamCaptainPlayer(selectedData?.awayTeam?.players);

    return itemKeys.reduce((result, itemKey) => {
      const normalizedKey = String(itemKey || "").trim().toLowerCase();
      const valueMap = {
        "#img:away_team:player_1": awayPlayer
          ? this.utils.buildImageManifestPayload("#img:away_team:player", {
              awayTeamName: this.utils.getTeamImageNameValue(awayTeam),
              playerName: this.utils.getPlayerDisplayName(awayPlayer),
            })
          : "",
        "#img:home_team:player_1": homePlayer
          ? this.utils.buildImageManifestPayload("#img:home_team:player", {
              homeTeamName: this.utils.getTeamImageNameValue(homeTeam),
              playerName: this.utils.getPlayerDisplayName(homePlayer),
            })
          : "",
      };

      result[itemKey] = valueMap[normalizedKey] || "";
      return result;
    }, {});
  }

  getSelectionLimit(manifest) {
    const statisticsSection = this.utils.getManifestConfiguredSections(manifest).find((section) => {
      if (!section.isList) {
        return false;
      }

      const normalizedItemKeys = section.itemKeys.map(this.utils.normalizeManifestKey);
      return (
        normalizedItemKeys.some((itemKey) =>
          ["home_value", "away_value", "description", "stat_label", "match_stats"].includes(itemKey)
        ) || section.normalizedKey.includes("stat")
      );
    });

    return statisticsSection?.fieldRows?.length || 5;
  }

  isScene4012Manifest(manifest) {
    return Number(manifest?.metadata?.scene) === 4012;
  }

  getSectionItemKeys(section, fallbackKeys = []) {
    if (Array.isArray(section?.item) && section.item.length) {
      return section.item;
    }

    if (Array.isArray(section?.list_item) && section.list_item.length) {
      return section.list_item;
    }

    return fallbackKeys;
  }

  buildCombinedValue(selectedData, item, suffix) {
    const homeTeam = selectedData?.homeTeam?.team || {};
    const awayTeam = selectedData?.awayTeam?.team || {};

    return `${this.utils.getTeamBadgeValue(homeTeam)} ${this.appendSuffix(item.homeValue, suffix)} (${this.utils.formatMatchStatsFieldLabel(
      item.label
    )}) ${this.appendSuffix(item.awayValue, suffix)} ${this.utils.getTeamBadgeValue(awayTeam)}`
      .replace(/\s+/g, " ")
      .trim();
  }

  buildScoreValue(selectedData) {
    return `${this.utils.getTeamScoreValue(selectedData?.homeTeam)} - ${this.utils.getTeamScoreValue(selectedData?.awayTeam)}`.trim();
  }

  resolveSectionItemValue(itemKey, selectedData) {
    const homeTeam = selectedData?.homeTeam?.team || {};
    const awayTeam = selectedData?.awayTeam?.team || {};
    const homeCaptain = this.utils.findTeamCaptainPlayer(selectedData?.homeTeam?.players);
    const awayCaptain = this.utils.findTeamCaptainPlayer(selectedData?.awayTeam?.players);
    const normalizedKey = this.utils.normalizeManifestKey(itemKey);
    const imageValue = this.utils.buildImageManifestPayload(itemKey, {
      awayCaptainName: awayCaptain ? this.utils.getPlayerDisplayName(awayCaptain) : "",
      awayTeamName: this.utils.getTeamImageNameValue(awayTeam),
      homeCaptainName: homeCaptain ? this.utils.getPlayerDisplayName(homeCaptain) : "",
      homeTeamName: this.utils.getTeamImageNameValue(homeTeam),
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
      return this.utils.getPeriodLabelValue(selectedData);
    }

    if (normalizedKey === "title" || normalizedKey.includes("title")) {
      return "Match Stats";
    }

    if (normalizedKey.includes("page_state") || normalizedKey === "value") {
      return this.utils.getPageStateValue(selectedData);
    }

    if (normalizedKey.includes("match_info")) {
      return `Match Stats: ${this.utils.getTeamBadgeValue(homeTeam)} ${this.buildScoreValue(selectedData)} ${this.utils.getTeamBadgeValue(awayTeam)}`.trim();
    }

    if (normalizedKey.includes("home") && normalizedKey.includes("team") && normalizedKey.includes("name")) {
      return this.utils.getTeamNameValue(homeTeam);
    }

    if (normalizedKey.includes("away") && normalizedKey.includes("team") && normalizedKey.includes("name")) {
      return this.utils.getTeamNameValue(awayTeam);
    }

    if (normalizedKey.includes("score") && !normalizedKey.includes("home") && !normalizedKey.includes("away")) {
      return this.buildScoreValue(selectedData);
    }

    if (normalizedKey.includes("home") && (normalizedKey.includes("score") || normalizedKey.includes("value"))) {
      return this.utils.getTeamScoreValue(selectedData?.homeTeam);
    }

    if (normalizedKey.includes("away") && (normalizedKey.includes("score") || normalizedKey.includes("value"))) {
      return this.utils.getTeamScoreValue(selectedData?.awayTeam);
    }

    if (normalizedKey.includes("home") && (normalizedKey.includes("badge") || normalizedKey.includes("abbr"))) {
      return this.utils.getTeamBadgeValue(homeTeam);
    }

    if (normalizedKey.includes("away") && (normalizedKey.includes("badge") || normalizedKey.includes("abbr"))) {
      return this.utils.getTeamBadgeValue(awayTeam);
    }

    return "";
  }

  resolveStatisticValue(itemKey, selectedData, item, suffix) {
    const normalizedKey = this.utils.normalizeManifestKey(itemKey);

    if (normalizedKey.includes("home") && normalizedKey.includes("suffix")) {
      return suffix || "";
    }

    if (normalizedKey.includes("away") && normalizedKey.includes("suffix")) {
      return suffix || "";
    }

    if (normalizedKey.includes("home") && normalizedKey.includes("value")) {
      return this.appendSuffix(item.homeValue, suffix);
    }

    if (normalizedKey.includes("away") && normalizedKey.includes("value")) {
      return this.appendSuffix(item.awayValue, suffix);
    }

    if (normalizedKey.includes("description") || normalizedKey.includes("label")) {
      return this.utils.formatMatchStatsFieldLabel(item.label);
    }

    if (normalizedKey.includes("match_stats") || normalizedKey === "stat_value") {
      return this.buildCombinedValue(selectedData, item, suffix);
    }

    return "";
  }

  appendSuffix(value, suffix) {
    if (!suffix) {
      return value;
    }

    if (value === null || value === undefined || value === "" || value === "-") {
      return value;
    }

    return `${value}${suffix}`;
  }

  buildManifestLikeData(selectedData, selectedStatPaths, options = {}) {
    const manifest = options.manifest;
    const selectionLimit = this.getSelectionLimit(manifest);
    const suffixByPath = options.suffixByPath || {};
    const selectedItems = this.getSelectableItems(selectedData, selectedStatPaths).slice(0, selectionLimit);
    const sections = this.utils.getManifestConfiguredSections(manifest);

    return sections.reduce(
      (result, section) => {
        if (section.isList) {
          result[section.key] = {
            data: selectedItems.slice(0, section.fieldRows.length || selectedItems.length).map((item) => {
              const suffix = suffixByPath[item.path] ?? item.defaultSuffix;

              return section.itemKeys.reduce((row, itemKey) => {
                row[itemKey] = this.resolveStatisticValue(itemKey, selectedData, item, suffix);
                return row;
              }, {});
            }),
            list_item: section.itemKeys,
          };

          return result;
        }

        result[section.key] = {
          data: section.itemKeys.reduce((sectionData, itemKey) => {
            sectionData[itemKey] = this.resolveSectionItemValue(itemKey, selectedData);
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
}

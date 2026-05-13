export class PlayerStatsDataTypeWorker {
  constructor(utils) {
    this.utils = utils;
  }

  isDataType(selectedDataType) {
    const combinedLabel = `${selectedDataType?.dataType || ""} ${selectedDataType?.type || ""}`.toLowerCase();
    return combinedLabel.includes("player") && combinedLabel.includes("stat") && !combinedLabel.includes("top 10") && !combinedLabel.includes("top10");
  }

  collectStatPaths(stats, parentPath = "", paths = new Set()) {
    const statsRecord = this.utils.isRecord(stats) ? stats : null;

    Object.keys(statsRecord || {}).forEach((key) => {
      const nextPath = parentPath ? `${parentPath}.${key}` : key;
      const value = statsRecord?.[key];

      if (this.utils.isRecord(value)) {
        this.collectStatPaths(value, nextPath, paths);
        return;
      }

      if (value !== undefined) {
        paths.add(nextPath);
      }
    });

    return Array.from(paths);
  }

  getSelectableItems(player, selectedStatPaths) {
    const playerStats = player?.stats || {};

    return selectedStatPaths.map((path) => ({
      defaultSuffix: this.utils.matchStatsWorker.getDefaultSuffix(path),
      id: path,
      label: this.utils.formatStatDescription(path),
      path,
      value: this.utils.matchStatsWorker.formatValue(this.utils.getNestedValue(playerStats, path)),
    }));
  }

  buildManifestLikeData(selectedData, selection, selectedStatPaths, options = {}) {
    const selectedPlayer = selection?.player?.raw || null;
    const teamOption = selection?.teamOption || null;

    if (!selectedPlayer || !teamOption) {
      return null;
    }

    const manifest = options.manifest;
    const suffixByPath = options.suffixByPath || {};
    const selectionLimit = this.utils.matchStatsWorker.getSelectionLimit(manifest);
    const team = teamOption.teamData?.team || {};
    const teamName = this.utils.getTeamNameValue(team);
    const teamImageName = this.utils.getTeamImageNameValue(team);
    const playerName = this.utils.getPlayerDisplayName(selectedPlayer);
    const positionName = selectedPlayer?.position?.name ? this.utils.humanizeLabel(selectedPlayer.position.name) : "";
    const pageStateKeys = this.utils.matchStatsWorker.getSectionItemKeys(manifest?.page_state, ["value"]);
    const statisticsKeys = this.utils.matchStatsWorker.getSectionItemKeys(manifest?.stats_list, ["stat_label", "stat_value"]);
    const playerHeaderKeys = this.utils.matchStatsWorker.getSectionItemKeys(manifest?.player_header, []);
    const jerseyNumberKeys = this.utils.matchStatsWorker.getSectionItemKeys(manifest?.jersey_number, ["jersey_number"]);
    const selectedItems = this.getSelectableItems(selectedPlayer, selectedStatPaths).slice(0, selectionLimit);
    const filteredStats = selectedStatPaths.reduce((result, path) => {
      this.utils.setNestedValue(result, path, this.utils.getNestedValue(selectedPlayer?.stats || {}, path));
      return result;
    }, {});

    const resolveHeaderValue = (itemKey) => {
      if (typeof itemKey === "string" && itemKey.startsWith("#img:")) {
        return this.utils.buildImageManifestPayload(itemKey, {
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
        return this.utils.buildImageManifestPayload("#img:team_logo", { teamName: teamImageName });
      }

      if (["player_image", "playerimage", "image"].includes(normalizedKey)) {
        return this.utils.buildImageManifestPayload("#img:team:player", { playerName, teamName: teamImageName });
      }

      if (["jersey_number", "shirt_number", "shirtnumber"].includes(normalizedKey)) {
        return this.utils.getPlayerShirtNumber(selectedPlayer) ?? "";
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
      player_image: this.utils.buildImageManifestPayload("#img:team:player", { playerName, teamName: teamImageName }),
      player_name: playerName,
      position_name: positionName,
      page_state: {
        data: pageStateKeys.reduce((result, itemKey) => {
          result[itemKey] = itemKey === "value" ? this.utils.getPageStateValue(selectedData) : "";
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
              result[itemKey] = this.utils.matchStatsWorker.appendSuffix(item.value, suffixByPath[item.path] ?? item.defaultSuffix);
            }

            return result;
          }, {})
        ),
        list_item: statisticsKeys,
      },
      team,
      team_logo: this.utils.buildImageManifestPayload("#img:team_logo", { teamName: teamImageName }),
      team_name: teamName,
      jersey_number: {
        data: jerseyNumberKeys.reduce((result, itemKey) => {
          result[itemKey] = this.utils.getPlayerShirtNumber(selectedPlayer) ?? "";
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
}

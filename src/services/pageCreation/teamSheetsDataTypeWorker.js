export class TeamSheetsDataTypeWorker {
  constructor(utils) {
    this.utils = utils;
  }

  isPayload(selectedData) {
    return Boolean(
      Array.isArray(selectedData?.homeTeam?.players) ||
        Array.isArray(selectedData?.awayTeam?.players) ||
        Array.isArray(selectedData?.officials)
    );
  }

  getSelectionId(scope, teamKey, entity, index) {
    const entityId = entity?.id ?? `${scope}-${index + 1}`;
    return teamKey ? `${teamKey}.${scope}.${entityId}` : `${scope}.${entityId}`;
  }

  normalizeComparisonValue(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  getImageResolutionFailureName(message) {
    const normalizedMessage = String(message || "");
    const directMatch = normalizedMessage.match(/Unable to resolve (?:player|team) image for ['"]([^'"]+)['"]/i);

    if (directMatch?.[1]) {
      return directMatch[1].trim();
    }

    const fallbackMatch = normalizedMessage.match(/Unable to resolve .*?image.*?['"]([^'"]+)['"]/i);
    return fallbackMatch?.[1]?.trim() || "";
  }

  getPersonNameParts(person, fallback = "Person") {
    const displayName = this.utils.getPersonDisplayName(person, fallback).trim();
    const nameParts = displayName.split(/\s+/).filter(Boolean);

    return {
      displayName,
      name: person?.firstName || nameParts[0] || "",
      surname:
        person?.lastName || person?.surname || person?.familyName || nameParts.slice(1).join(" ") || "",
    };
  }

  getPlayerIdsByName(teamOption, playerName) {
    if (!teamOption || !playerName) {
      return [];
    }

    const normalizedPlayerName = this.normalizeComparisonValue(playerName);

    return teamOption.players
      .filter((player) => {
        const nameParts = this.getPersonNameParts(player.raw, "Player");
        const candidateNames = [
          player.primary,
          this.utils.getPlayerDisplayName(player.raw),
          nameParts.displayName,
          nameParts.name,
          nameParts.surname,
          [nameParts.name, nameParts.surname].filter(Boolean).join(" "),
          player.raw?.knownName,
          player.raw?.name,
        ];

        return candidateNames.some((candidateName) => this.normalizeComparisonValue(candidateName) === normalizedPlayerName);
      })
      .map((player) => player.id);
  }

  getTeamLabel(teamData, fallback) {
    return teamData?.team?.shortName || teamData?.team?.name || fallback;
  }

  isSubstitutePlayer(player) {
    const shirtNumber = Number(this.utils.getPlayerShirtNumber(player));
    return Number.isFinite(shirtNumber) && shirtNumber >= 16;
  }

  sortPlayersByShirtNumber(players) {
    return [...players].sort((left, right) => {
      const leftNumber = Number(this.utils.getPlayerShirtNumber(left));
      const rightNumber = Number(this.utils.getPlayerShirtNumber(right));

      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
      }

      return this.utils.getPlayerDisplayName(left).localeCompare(this.utils.getPlayerDisplayName(right));
    });
  }

  getSectionConfig(config, fallbackItemKeys = []) {
    if (!this.utils.isRecord(config)) {
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

  getManifestSections(manifest) {
    const manifestConfig = this.utils.isRecord(manifest) ? manifest : {};
    const manifestSections = this.utils.getManifestConfiguredSections(manifestConfig);
    const findSection = (predicate, fallbackConfig = null, fallbackItemKeys = []) => {
      const section = manifestSections.find(predicate);

      if (section) {
        return {
          fields: section.fieldRows,
          itemKeys: section.itemKeys,
          key: section.key,
        };
      }

      if (this.utils.isRecord(fallbackConfig)) {
        return this.getSectionConfig(fallbackConfig, fallbackItemKeys);
      }

      return {
        fields: [],
        key: "",
        itemKeys: [],
      };
    };

    const isCoachSection = (section) => {
      const itemKeys = section.itemKeys.map(this.utils.normalizeManifestKey);
      return !section.isList && (section.normalizedKey.includes("coach") || itemKeys.some((itemKey) => itemKey.includes("coach")));
    };

    const isHeadCoachSection = (section) => {
      const itemKeys = section.itemKeys.map(this.utils.normalizeManifestKey);
      return isCoachSection(section) && (section.normalizedKey.includes("head") || itemKeys.some((itemKey) => itemKey.includes("head")));
    };

    const isPlayerSection = (section) => {
      const itemKeys = section.itemKeys.map(this.utils.normalizeManifestKey);
      return (
        section.isList &&
        itemKeys.some((itemKey) => itemKey.includes("player") || itemKey.includes("jersey") || itemKey === "name" || itemKey === "surname")
      );
    };

    const isSubstituteSection = (section) => isPlayerSection(section) && /(sub|replacement|bench)/.test(section.normalizedKey);
    const isHeaderSection = (section) => {
      const itemKeys = section.itemKeys.map(this.utils.normalizeManifestKey);
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
      homeTeamReplacements: this.getSectionConfig(manifestConfig.home_team_replacements, ["jersey_number", "name", "surname"]),
      awayTeamReplacements: this.getSectionConfig(manifestConfig.away_team_replacements, ["jersey_number", "name", "surname"]),
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
        (section) => !section.isList && section.itemKeys.map(this.utils.normalizeManifestKey).some((itemKey) => itemKey.includes("team_logo")),
        manifestConfig.team_logo,
        ["#img:team_logo"]
      ),
      teamName: findSection(
        (section) => !section.isList && section.itemKeys.map(this.utils.normalizeManifestKey).some((itemKey) => itemKey.includes("team_name") || itemKey === "name"),
        manifestConfig.team_name,
        ["name"]
      ),
    };
  }

  isReplacementsManifest(manifestSections) {
    return Boolean(
      manifestSections?.homeTeamReplacements?.fields?.length || manifestSections?.awayTeamReplacements?.fields?.length
    );
  }

  buildTeamNameOptions(teamData, fallbackLabel) {
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

  buildTeamOptions(selectedData) {
    return [
      ["homeTeam", selectedData?.homeTeam, "Home"],
      ["awayTeam", selectedData?.awayTeam, "Away"],
    ].flatMap(([teamKey, teamData, fallbackLabel]) => {
      if (!teamData) {
        return [];
      }

      const label = this.getTeamLabel(teamData, fallbackLabel);
      const players = this.sortPlayersByShirtNumber(teamData?.players || []).map((player, index) => {
        const shirtNumber = this.utils.getPlayerShirtNumber(player);
        const positionName = player?.position?.name ? this.utils.humanizeLabel(player.position.name) : null;
        const tags = [player?.captain === "true" ? "Captain" : null, positionName].filter(Boolean);

        return {
          badge: shirtNumber !== null && shirtNumber !== undefined ? String(shirtNumber) : "-",
          id: this.getSelectionId("players", teamKey, player, index),
          primary: this.utils.getPlayerDisplayName(player),
          raw: player,
          secondary: tags.join(" | "),
        };
      });

      const coaches = (teamData?.coaches || []).map((coach, index) => ({
        badge: "C",
        id: this.getSelectionId("coaches", teamKey, coach, index),
        primary: this.utils.getPersonDisplayName(coach, "Coach"),
        raw: coach,
        secondary: coach?.role?.name ? this.utils.humanizeLabel(coach.role.name) : "Coach",
      }));

      return [
        {
          coaches,
          label,
          players,
          teamData,
          teamKey,
          teamNameOptions: this.buildTeamNameOptions(teamData, label),
        },
      ];
    });
  }

  isHeadCoach(entity) {
    const roleLabel = entity?.role?.name || entity?.role || "";
    return String(roleLabel).toLowerCase().includes("head");
  }

  getDefaultCoachSelections(teamOption) {
    const headCoach = teamOption?.coaches.find((coach) => this.isHeadCoach(coach.raw)) || teamOption?.coaches[0] || null;
    const coach = teamOption?.coaches.find((item) => item.id !== headCoach?.id) || headCoach || null;

    return {
      coachId: coach?.id || "",
      headCoachId: headCoach?.id || coach?.id || "",
    };
  }

  getPresetFields(selectedDataType) {
    const presetCandidates = [
      selectedDataType?.teamSheetFields,
      selectedDataType?.team_sheet_fields,
      selectedDataType?.teamSheetData,
      selectedDataType?.fields,
    ];

    return (
      presetCandidates.find(
        (candidate) =>
          this.utils.isRecord(candidate) &&
          (candidate.players_list || candidate.players || candidate.head_coach || candidate.coach || candidate.team_name)
      ) || null
    );
  }

  findTeamOption(teamOptions, reference) {
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

  findOptionByReference(items, reference) {
    if (!reference) {
      return null;
    }

    const referenceValue = this.utils.isRecord(reference)
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

  resolvePresetSelection(teamOptions, preset, playerLimit) {
    if (!preset || !teamOptions.length) {
      return null;
    }

    const teamOption =
      this.findTeamOption(teamOptions, preset.teamKey || preset.team || preset.side || preset.team_name?.name) ||
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
      coachId: this.findOptionByReference(teamOption.coaches, coachReference)?.id || "",
      headCoachId: this.findOptionByReference(teamOption.coaches, headCoachReference)?.id || "",
      playerIds: presetPlayers
        .map((player) => this.findOptionByReference(teamOption.players, player)?.id || "")
        .filter(Boolean)
        .slice(0, playerLimit),
      teamKey: teamOption.teamKey,
      teamName: teamNameReference,
    };
  }

  getValueByKey(source, key, type, teamName = "", options = {}) {
    const displayName =
      type === "player"
        ? this.utils.getPlayerDisplayName(source)
        : type === "coach"
          ? this.utils.getPersonDisplayName(source, "Coach")
          : "";
    const imagePayload = this.utils.buildImageManifestPayload(key, {
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
      return this.utils.buildImageManifestPayload("#img:team:player", {
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

    const nameParts = this.getPersonNameParts(source, type === "player" ? "Player" : "Coach");

    if (["jersey_number", "shirt_number", "shirtnumber"].includes(canonicalKey)) {
      return this.utils.getPlayerShirtNumber(source) ?? "";
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

  resolveManifestValue(itemKey, source, type, selectedData, teamName, options = {}) {
    const normalizedKey = this.utils.normalizeManifestKey(itemKey);

    if (normalizedKey.includes("competition")) {
      return selectedData?.competition?.name || "";
    }

    if (normalizedKey.includes("season")) {
      return selectedData?.season?.name || "";
    }

    if (normalizedKey.includes("venue")) {
      return selectedData?.venue?.name || "";
    }

    return this.getValueByKey(source, itemKey, type, teamName, options);
  }

  buildManifestRows(players, itemKeys, rowCount, selectedData, teamName, teamImageName) {
    return Array.from({ length: rowCount }, (_, index) => {
      const player = players[index] || null;

      return itemKeys.reduce((result, itemKey) => {
        result[itemKey] = player
          ? this.resolveManifestValue(itemKey, player, "player", selectedData, teamName, {
              awayTeamName: this.utils.getTeamNameValue(selectedData?.awayTeam?.team || {}),
              homeTeamName: this.utils.getTeamNameValue(selectedData?.homeTeam?.team || {}),
              teamImageName,
            })
          : "";
        return result;
      }, {});
    });
  }

  buildReplacementRows(teamData, itemKeys, rowCount, selectedData) {
    const resolvedItemKeys = Array.isArray(itemKeys) && itemKeys.length ? itemKeys : ["jersey_number", "name", "surname"];
    const team = teamData?.team || {};
    const resolvedTeamName = this.utils.getTeamNameValue(team);
    const resolvedTeamImageName = this.utils.getTeamImageNameValue(team) || resolvedTeamName;
    const homeTeamName = this.utils.getTeamNameValue(selectedData?.homeTeam?.team || {});
    const awayTeamName = this.utils.getTeamNameValue(selectedData?.awayTeam?.team || {});
    const replacements = this.sortPlayersByShirtNumber((teamData?.players || []).filter((player) => this.isSubstitutePlayer(player)));

    return Array.from({ length: rowCount }, (_, index) => {
      const player = replacements[index] || null;

      return resolvedItemKeys.reduce((result, itemKey) => {
        result[itemKey] = player
          ? this.getValueByKey(player, itemKey, "player", resolvedTeamName, {
              awayTeamName,
              homeTeamName,
              teamImageName: resolvedTeamImageName,
            })
          : "";
        return result;
      }, {});
    });
  }

  buildMatchHeaderData(selectedData, itemKeys) {
    const resolvedItemKeys = Array.isArray(itemKeys) && itemKeys.length
      ? itemKeys
      : ["#img:home_team_logo", "home_team_name", "#img:away_team_logo", "away_team_name"];
    const homeTeam = selectedData?.homeTeam?.team || {};
    const awayTeam = selectedData?.awayTeam?.team || {};

    return resolvedItemKeys.reduce((result, itemKey) => {
      const valueMap = {
        away_team_name: this.utils.getTeamNameValue(awayTeam),
        home_team_name: this.utils.getTeamNameValue(homeTeam),
      };

      result[itemKey] =
        valueMap[itemKey] ??
        this.utils.buildImageManifestPayload(itemKey, {
          awayTeamName: this.utils.getTeamImageNameValue(awayTeam),
          homeTeamName: this.utils.getTeamImageNameValue(homeTeam),
        }) ??
        "";
      return result;
    }, {});
  }

  buildManifestLikeData(selectedData, selection, manifestSections) {
    if (this.isReplacementsManifest(manifestSections)) {
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
          data: this.buildMatchHeaderData(selectedData, matchHeaderItemKeys),
          item: matchHeaderItemKeys,
        },
        home_team_replacements: {
          data: this.buildReplacementRows(
            selectedData?.homeTeam,
            homeReplacementItemKeys,
            homeReplacementRowCount,
            selectedData
          ),
          list_item: homeReplacementItemKeys,
        },
        away_team_replacements: {
          data: this.buildReplacementRows(
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
    const resolvedTeamImageName = this.utils.getTeamImageNameValue(teamOption.teamData?.team || {}) || resolvedTeamName;
    const homeTeamName = this.utils.getTeamNameValue(selectedData?.homeTeam?.team || {});
    const awayTeamName = this.utils.getTeamNameValue(selectedData?.awayTeam?.team || {});
    const selectedPlayers = selection.playerIds.map((playerId) => playersById.get(playerId)).filter(Boolean);
    const selectedPlayerIdSet = new Set(selection.playerIds);
    const remainingPlayers = teamOption.players
      .filter((player) => !selectedPlayerIdSet.has(player.id))
      .map((player) => player.raw);
    const substitutePlayers = this.sortPlayersByShirtNumber(
      remainingPlayers.some((player) => this.isSubstitutePlayer(player))
        ? remainingPlayers.filter((player) => this.isSubstitutePlayer(player))
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
                ? this.buildManifestRows(
                    substitutePlayers,
                    itemKeys,
                    rowCount,
                    selectedData,
                    resolvedTeamName,
                    resolvedTeamImageName
                  )
                : this.buildManifestRows(
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
                ? this.resolveManifestValue(itemKey, sectionSource, sectionType, selectedData, resolvedTeamName, {
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
            ? this.getValueByKey(coach, itemKey, "coach", resolvedTeamName, {
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
            ? this.getValueByKey(headCoach, itemKey, "coach", resolvedTeamName, {
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
            result[itemKey] = this.getValueByKey(player, itemKey, "player", resolvedTeamName, {
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
          result[itemKey] = this.getValueByKey(teamOption.teamData?.team || {}, itemKey, "team", resolvedTeamName, {
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
          result[itemKey] = this.getValueByKey(teamOption.teamData?.team || {}, itemKey, "team", resolvedTeamName, {
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
}

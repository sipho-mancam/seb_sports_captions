import { apiClient, throwRequestError } from "./apiClient";

function normalizeProfile(profile) {
  if (!profile) {
    return null;
  }

  return {
    name: profile.name || "",
    graphicManifestPath: profile.graphic_manifest_path || profile.graphicManifestPath || "",
    mseUrl: profile.mse_url || profile.mseUrl || "",
    statsPageDefaultsPath: profile.stats_page_defaults_path || profile.statsPageDefaultsPath || "",
    imageAssetsPath: profile.image_assets_path || profile.imageAssetsPath || "",
    pages: Array.isArray(profile.pages) ? profile.pages : [],
    selectedShow: profile.selected_show ?? profile.selectedShow ?? null,
  };
}

export class ProfileWorker {
  constructor(client = apiClient) {
    this.client = client;
  }

  async getActiveProfile() {
    const response = await this.client.request("/api/v1/sportscaption/profiles/active");

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      await throwRequestError(response, `Failed to load active profile (${response.status})`);
    }

    return normalizeProfile(await response.json());
  }

  async getProfiles() {
    const payload = await this.client.getJson("/api/v1/sportscaption/profiles", "Failed to load profiles");
    return Array.isArray(payload) ? payload.map(normalizeProfile).filter(Boolean) : [];
  }

  async createProfile(profile) {
    const payload = await this.client.postJson(
      "/api/v1/sportscaption/profiles",
      {
        name: profile.name,
        graphic_manifest_path: profile.graphic_manifest_path,
        mse_url: profile.mse_url,
        selected_show: profile.selected_show ?? null,
        pages: Array.isArray(profile.pages) ? profile.pages : [],
        stats_page_defaults_path: profile.stats_page_defaults_path || "",
        image_assets_path: profile.image_assets_path || "",
      },
      "Failed to create profile"
    );

    return normalizeProfile(payload);
  }

  async setActiveProfile(profileName) {
    const payload = await this.client.postJson(
      "/api/v1/sportscaption/profiles/active",
      { name: profileName },
      "Failed to set active profile"
    );

    return normalizeProfile(payload);
  }

  async getActiveProfileStatsPageDefaults() {
    const response = await this.client.request("/api/v1/sportscaption/profiles/active/stats-page-defaults");

    if (response.status === 404) {
      return {};
    }

    if (!response.ok) {
      await throwRequestError(response, `Failed to load active profile stats defaults (${response.status})`);
    }

    const payload = await response.json();
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  }
}

export const profileWorker = new ProfileWorker();

export function getActiveProfile() {
  return profileWorker.getActiveProfile();
}

export function getProfiles() {
  return profileWorker.getProfiles();
}

export function createProfile(profile) {
  return profileWorker.createProfile(profile);
}

export function setActiveProfile(profileName) {
  return profileWorker.setActiveProfile(profileName);
}

export function getActiveProfileStatsPageDefaults() {
  return profileWorker.getActiveProfileStatsPageDefaults();
}
import { useEffect, useState } from "react";
import { useAppFlow } from "../context/AppFlowContext";
import {
  createProfile,
  getActiveProfile,
  getProfiles,
  setActiveProfile as activateProfile,
} from "../services/graphicsService";

const defaultProfileForm = {
  name: "default",
  graphic_manifest_path:
    "C:/Users/SiphoMancam/Documents/Programming/SportsCaptionsServer/graphic_manifest",
  mse_url: "http://localhost:8580/directory/",
};

function formatCreatedAt(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function MatchProfilePanel() {
  const { state, setActiveProfile } = useAppFlow();
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [createError, setCreateError] = useState("");
  const [profileForm, setProfileForm] = useState(defaultProfileForm);
  const [isProfilePickerOpen, setIsProfilePickerOpen] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [profilesError, setProfilesError] = useState("");
  const [activatingProfileName, setActivatingProfileName] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadActiveProfile() {
      setLoadingProfile(true);
      setProfileError("");

      try {
        const profile = await getActiveProfile();
        if (mounted) {
          setActiveProfile(profile);
        }
      } catch (error) {
        if (mounted) {
          setProfileError(error.message || "Failed to load active profile.");
          setActiveProfile(null);
        }
      } finally {
        if (mounted) {
          setLoadingProfile(false);
        }
      }
    }

    loadActiveProfile();

    return () => {
      mounted = false;
    };
  }, [setActiveProfile]);

  const activeProfile = state.activeProfile;

  const onCreateProfile = async (event) => {
    event.preventDefault();
    setCreateError("");

    try {
      const createdProfile = await createProfile(profileForm);
      const active = await activateProfile(createdProfile.name);
      setActiveProfile(active);
      setIsCreatingProfile(false);
      setProfileForm({
        name: active.name,
        graphic_manifest_path: active.graphicManifestPath,
        mse_url: active.mseUrl,
      });
    } catch (error) {
      setCreateError(error.message || "Failed to create profile.");
    }
  };

  const closeProfilePicker = () => {
    if (activatingProfileName) {
      return;
    }

    setIsProfilePickerOpen(false);
    setProfilesError("");
  };

  const onOpenProfilePicker = async () => {
    setIsCreatingProfile(false);
    setCreateError("");
    setProfilesError("");
    setIsProfilePickerOpen(true);
    setLoadingProfiles(true);

    try {
      const profileList = await getProfiles();
      setProfiles(profileList);
    } catch (error) {
      setProfiles([]);
      setProfilesError(error.message || "Failed to load profiles.");
    } finally {
      setLoadingProfiles(false);
    }
  };

  const onActivateProfile = async (profileName) => {
    setProfilesError("");
    setActivatingProfileName(profileName);

    try {
      const active = await activateProfile(profileName);
      setActiveProfile(active);
      setProfileForm({
        name: active.name,
        graphic_manifest_path: active.graphicManifestPath,
        mse_url: active.mseUrl,
      });
      setIsProfilePickerOpen(false);
    } catch (error) {
      setProfilesError(error.message || "Failed to activate profile.");
    } finally {
      setActivatingProfileName("");
    }
  };

  return (
    <aside className="match-profile-panel">
      <div className="match-profile-panel__header">
        <div>
          <h2>{activeProfile?.name || "No Active Profile"}</h2>
          <p>Profiles control the graphics manifest path and MSE target for created pages.</p>
        </div>
        <div className="match-profile-panel__actions">
          <button
            type="button"
            className="match-profile-panel__button"
            onClick={onOpenProfilePicker}
          >
            Activate Profile
          </button>
          <button
            type="button"
            className="match-profile-panel__button"
            onClick={() => {
              setIsProfilePickerOpen(false);
              setProfilesError("");
              setCreateError("");
              setIsCreatingProfile((current) => !current);
            }}
          >
            {isCreatingProfile ? "Close" : "Create Profile"}
          </button>
        </div>
      </div>

      {loadingProfile ? <p className="match-profile-panel__message">Loading active profile...</p> : null}
      {profileError ? (
        <p className="match-profile-panel__message match-profile-panel__message--error">{profileError}</p>
      ) : null}

      <div className="match-profile-panel__details">
        <div>
          <span>Graphics Manifest</span>
          <strong>{activeProfile?.graphicManifestPath || "No active profile selected"}</strong>
        </div>
        <div>
          <span>MSE URL</span>
          <strong>{activeProfile?.mseUrl || "No active profile selected"}</strong>
        </div>
      </div>

      {!activeProfile ? (
        <p className="match-profile-panel__message match-profile-panel__message--warning">
          An active profile is required before a page can be created.
        </p>
      ) : null}

      {isCreatingProfile ? (
        <form className="match-profile-panel__form" onSubmit={onCreateProfile}>
          <label>
            <span>Profile Name</span>
            <input
              type="text"
              value={profileForm.name}
              onChange={(event) =>
                setProfileForm((current) => ({ ...current, name: event.target.value }))
              }
              required
            />
          </label>

          <label>
            <span>Graphics Manifest Path</span>
            <input
              type="text"
              value={profileForm.graphic_manifest_path}
              onChange={(event) =>
                setProfileForm((current) => ({
                  ...current,
                  graphic_manifest_path: event.target.value,
                }))
              }
              required
            />
          </label>

          <label>
            <span>MSE URL</span>
            <input
              type="url"
              value={profileForm.mse_url}
              onChange={(event) =>
                setProfileForm((current) => ({ ...current, mse_url: event.target.value }))
              }
              required
            />
          </label>

          {createError ? (
            <p className="match-profile-panel__message match-profile-panel__message--error">
              {createError}
            </p>
          ) : null}

          <button type="submit" className="match-profile-panel__button match-profile-panel__button--primary">
            Save and Activate
          </button>
        </form>
      ) : null}

      {isProfilePickerOpen ? (
        <div className="modal-overlay" onClick={closeProfilePicker}>
          <div className="modal-card match-profile-panel__picker" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Activate Profile</h3>
              <button
                type="button"
                className="modal-close"
                onClick={closeProfilePicker}
                aria-label="Close profile chooser"
              >
                x
              </button>
            </div>
            <p className="subtitle modal-subtitle">Choose the profile you want to activate.</p>

            {loadingProfiles ? <p className="match-profile-panel__message">Loading profiles...</p> : null}
            {profilesError ? (
              <p className="match-profile-panel__message match-profile-panel__message--error">{profilesError}</p>
            ) : null}

            {!loadingProfiles && !profilesError ? (
              profiles.length ? (
                <div className="match-profile-panel__profile-list">
                  {profiles.map((profile) => {
                    const isActive = activeProfile?.name === profile.name;
                    const isActivating = activatingProfileName === profile.name;

                    return (
                      <button
                        type="button"
                        key={profile.name}
                        className={`match-profile-panel__profile-item ${isActive ? "selected" : ""}`}
                        onClick={() => onActivateProfile(profile.name)}
                        disabled={Boolean(activatingProfileName)}
                      >
                        <strong>{profile.name}</strong>
                        <span>{profile.graphicManifestPath || "No graphics manifest configured"}</span>
                        <span>{profile.mseUrl || "No MSE URL configured"}</span>
                        <small>
                          {isActivating ? "Activating..." : isActive ? "Active profile" : "Set as active"}
                        </small>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="match-profile-panel__message">No profiles available.</p>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="match-profile-panel__pages">
        <div className="match-profile-panel__pages-header">
          <h3>Created Pages</h3>
          <span>{state.createdPages.length}</span>
        </div>

        {state.createdPages.length ? (
          <div className="match-profile-panel__page-list">
            {state.createdPages.map((page) => (
              <article className="match-profile-panel__page-item" key={page.id}>
                <strong>{page.title}</strong>
                <span>{page.profileName}</span>
                {page.templateName ? <span>Template: {page.templateName}</span> : null}
                {page.pageUri ? <span>Page: {page.pageUri}</span> : null}
                <span>{formatCreatedAt(page.createdAt)}</span>
              </article>
            ))}
          </div>
        ) : (
          <p className="match-profile-panel__message">No pages created yet.</p>
        )}
      </div>
    </aside>
  );
}
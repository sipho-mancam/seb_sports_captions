import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAppFlow } from "../context/AppFlowContext";

const steps = [
  { path: "/", label: "Sport" },
  { path: "/source", label: "Source" },
  { path: "/tournaments", label: "Tournament" },
  { path: "/stats", label: "Stats" },
  { path: "/graphics", label: "Graphics" },
];

export default function ProgressHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    state: { selectedSport, selectedSource, selectedTournament, selectedStatsType },
  } = useAppFlow();
  const isRootRoute = location.pathname === "/";

  const handleBack = () => {
    if (isRootRoute) {
      return;
    }

    if (location.key === "default") {
      navigate("/");
      return;
    }

    navigate(-1);
  };

  const canOpen = {
    "/": true,
    "/source": Boolean(selectedSport),
    "/tournaments": Boolean(selectedSport && selectedSource),
    "/stats": Boolean(selectedSport && selectedSource && selectedTournament),
    "/graphics": Boolean(
      selectedSport && selectedSource && selectedTournament && selectedStatsType
    ),
  };

  return (
    <header className="progress-header">
      <div className="progress-header__top">
        <button
          type="button"
          className="progress-header__back"
          onClick={handleBack}
          disabled={isRootRoute}
          aria-label="Go back"
        >
          <span aria-hidden="true" className="progress-header__back-icon">
            ←
          </span>
        </button>
        <h1>Sports Graphics Control Room</h1>
      </div>
      <nav>
        {steps.map((step) => (
          <NavLink
            key={step.path}
            to={canOpen[step.path] ? step.path : "#"}
            className={({ isActive }) =>
              `step-chip ${isActive ? "active" : ""} ${canOpen[step.path] ? "" : "locked"}`
            }
            onClick={(event) => {
              if (!canOpen[step.path]) {
                event.preventDefault();
              }
            }}
          >
            {step.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

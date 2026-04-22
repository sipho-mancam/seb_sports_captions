import { useNavigate } from "react-router-dom";
import { useAppFlow } from "../context/AppFlowContext";

const sports = [
  { name: "Rugby", enabled: true },
  { name: "Cricket", enabled: true },
  { name: "Soccer", enabled: false },
  { name: "Golf", enabled: false },
  { name: "NetBall", enabled: false },
];

export default function HomePage() {
  const navigate = useNavigate();
  const { setSport, state } = useAppFlow();

  const onSelectSport = (sport) => {
    if (!sport.enabled) {
      return;
    }
    setSport(sport.name);
    navigate("/source");
  };

  return (
    <section className="panel">
      <h2>1. Select Sporting Code</h2>
      <p className="subtitle">Choose the code you are currently producing graphics for.</p>
      <div className="sports-grid">
        {sports.map((sport) => (
          <button
            type="button"
            key={sport.name}
            className={`sport-card ${sport.enabled ? "enabled" : "disabled"} ${
              state.selectedSport === sport.name ? "selected" : ""
            }`}
            onClick={() => onSelectSport(sport)}
          >
            <span>{sport.name}</span>
            {!sport.enabled ? <small>Coming Soon</small> : null}
          </button>
        ))}
      </div>
    </section>
  );
}
